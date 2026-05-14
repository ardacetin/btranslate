import json
import asyncio
import datetime
from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, List
from ai_engine import RealtimeTranslationSession
from database import SessionLocal, EventSession, Transcript, Translation

def log_activity(msg: str):
    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{stamp}] {msg}\n"
    print(line.strip())
    try:
        with open("usage.log", "a", encoding="utf-8") as f:
            f.write(line)
    except:
        pass


class ConnectionManager:
    """
    Manages host ↔ participant WebSocket connections and orchestrates
    the OpenAI GPT-Realtime-Translate pipeline.
    """

    def __init__(self):
        self.active_sessions: Dict[str, Dict] = {}

    def get_or_create_session(self, event_code: str):
        if event_code not in self.active_sessions:
            self.active_sessions[event_code] = {
                "host": None,
                "participants": {},  # { "tr": [ws1, ws2], "en": [ws3] }
                "rt_sessions": {},   # { "tr": RealtimeTranslationSession, "en": RealtimeTranslationSession }
                "accumulated_original": "",
                "accumulated_translations": {},
                "db_transcript_id": None
            }
        return self.active_sessions[event_code]

    # ── Host ──────────────────────────────────────────────────────────────

    async def connect_host(self, websocket: WebSocket, event_code: str):
        await websocket.accept()
        session = self.get_or_create_session(event_code)
        session["host"] = websocket
        log_activity(f"HOST connected to Broadcast {event_code}")

        # Ensure DB session exists and get a transcript ID for tracking
        db = SessionLocal()
        try:
            db_session = db.query(EventSession).filter(EventSession.event_code == event_code).first()
            if db_session:
                transcript_obj = Transcript(session_id=db_session.id, original_text="")
                db.add(transcript_obj)
                db.commit()
                db.refresh(transcript_obj)
                session["db_transcript_id"] = transcript_obj.id
        except Exception as e:
            print(f"[DB] Failed to init transcript: {e}")
        finally:
            db.close()

    def disconnect_host(self, event_code: str, websocket: WebSocket):
        if event_code in self.active_sessions:
            session = self.active_sessions[event_code]
            if session.get("host") == websocket:
                session["host"] = None
                # Stop all active realtime sessions
                for lang, rt_session in session.get("rt_sessions", {}).items():
                    asyncio.create_task(rt_session.stop())
                session["rt_sessions"] = {}

    # ── Participants ──────────────────────────────────────────────────────

    async def _update_host_participant_count(self, event_code: str):
        session = self.active_sessions.get(event_code)
        if session and session.get("host"):
            total = sum(len(w) for w in session["participants"].values())
            msg = json.dumps({"type": "participant_count", "count": total})
            try:
                await session["host"].send_text(msg)
            except Exception:
                pass

    async def connect_participant(self, websocket: WebSocket, event_code: str, target_lang: str):
        await websocket.accept()
        session = self.get_or_create_session(event_code)
        if target_lang not in session["participants"]:
            session["participants"][target_lang] = []
        session["participants"][target_lang].append(websocket)
        total = sum(len(w) for w in session["participants"].values())
        log_activity(f"PARTICIPANT joined {event_code} (Lang: {target_lang}). Total in room: {total}")
        await self._update_host_participant_count(event_code)

        # Start a Realtime Session for this language if it doesn't exist
        if target_lang not in session.get("rt_sessions", {}):
            async def on_rt_event(lang: str, data: dict):
                await self._handle_realtime_event(event_code, lang, data)
                
            rt_session = RealtimeTranslationSession(target_lang, on_rt_event)
            session["rt_sessions"][target_lang] = rt_session
            await rt_session.start()

    def disconnect_participant(self, websocket: WebSocket, event_code: str, target_lang: str):
        if event_code in self.active_sessions:
            try:
                self.active_sessions[event_code]["participants"][target_lang].remove(websocket)
                asyncio.create_task(self._update_host_participant_count(event_code))
                
                # If no more participants for this language, we COULD stop the rt_session, 
                # but we'll leave it running for now in case they reconnect quickly.
            except (ValueError, KeyError):
                pass

    # ── Audio Forwarding ──────────────────────────────────────────────────

    async def send_audio_from_host(self, event_code: str, audio_bytes: bytes):
        """Forward raw audio from host to all active OpenAI Realtime sessions."""
        session = self.active_sessions.get(event_code)
        if not session:
            return
        
        # Fan out the audio to all active languages
        for lang, rt_session in session.get("rt_sessions", {}).items():
            if getattr(rt_session, '_running', False) is False:
                print(f"[SOCKETS] Reconnecting dead Realtime session for {lang}")
                await rt_session.start()
            await rt_session.send_audio(audio_bytes)

    # ── Event Handling ────────────────────────────────────────────────────

    async def _handle_realtime_event(self, event_code: str, lang: str, data: dict):
        """Handle incoming deltas from OpenAI and broadcast to participants."""
        session = self.active_sessions.get(event_code)
        if not session:
            return
            
        participants = session.get("participants", {}).get(lang, [])
        if not participants:
            return
            
        event_type = data.get("type")
        
        msg = {
            "type": event_type,
            "target_lang": lang
        }
        
        should_broadcast = False

        if event_type == "session.output_transcript.delta":
            delta = data.get("delta", "")
            if delta:
                msg["delta"] = delta
                should_broadcast = True
                # Accumulate history
                if lang not in session["accumulated_translations"]:
                    session["accumulated_translations"][lang] = ""
                session["accumulated_translations"][lang] += delta
                asyncio.create_task(self._update_db_history(session, lang))

        elif event_type == "session.input_transcript.delta":
            delta = data.get("delta", "")
            if delta:
                msg["delta"] = delta
                should_broadcast = True
                session["accumulated_original"] += delta
                asyncio.create_task(self._update_db_history(session, None))

        elif event_type == "session.output_audio.delta":
            delta = data.get("audio", "")
            if delta:
                msg["audio"] = delta
                should_broadcast = True
                
        if not should_broadcast:
            return

        message = json.dumps(msg)
        
        dead = []
        for ws in participants:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
                
        for ws in dead:
            try:
                participants.remove(ws)
            except ValueError:
                pass

    async def _update_db_history(self, session: dict, target_lang: str = None):
        """Debounced or periodic DB update for accumulated history."""
        # For simplicity, we update the existing row directly
        # In a high-scale production app, we'd debounce this.
        t_id = session.get("db_transcript_id")
        if not t_id:
            return
            
        db = SessionLocal()
        try:
            if target_lang is None:
                # Update original text
                t = db.query(Transcript).filter(Transcript.id == t_id).first()
                if t:
                    t.original_text = session["accumulated_original"]
                    db.commit()
            else:
                # Update translation text
                trans = db.query(Translation).filter(
                    Translation.transcript_id == t_id,
                    Translation.target_language == target_lang
                ).first()
                
                if trans:
                    trans.translated_text = session["accumulated_translations"][target_lang]
                    db.commit()
                else:
                    new_trans = Translation(
                        transcript_id=t_id,
                        target_language=target_lang,
                        translated_text=session["accumulated_translations"][target_lang]
                    )
                    db.add(new_trans)
                    db.commit()
        except Exception as e:
            print(f"[DB] Error updating history: {e}")
        finally:
            db.close()

manager = ConnectionManager()
