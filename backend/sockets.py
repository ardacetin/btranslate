from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, List
import json
import asyncio
import datetime
import base64
from ai_engine import (
    DeepgramStreamingSTT,
    translate_text,
    synthesize_speech,
    transcribe_audio_whisper,
    DEEPGRAM_API_KEY,
)

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
    the STT → Translation → TTS pipeline.
    """

    def __init__(self):
        self.active_sessions: Dict[str, Dict] = {}

    def get_or_create_session(self, event_code: str):
        if event_code not in self.active_sessions:
            self.active_sessions[event_code] = {
                "host": None,
                "participants": {},
                "dg_stt": None,         # DeepgramStreamingSTT instance
            }
        return self.active_sessions[event_code]

    # ── Host ──────────────────────────────────────────────────────────────

    async def connect_host(self, websocket: WebSocket, event_code: str):
        await websocket.accept()
        session = self.get_or_create_session(event_code)
        session["host"] = websocket
        log_activity(f"HOST connected to Broadcast {event_code}")

    def disconnect_host(self, event_code: str):
        if event_code in self.active_sessions:
            self.active_sessions[event_code]["host"] = None
            # Stop Deepgram STT connection if active
            dg_stt = self.active_sessions[event_code].get("dg_stt")
            if dg_stt:
                asyncio.create_task(dg_stt.stop())
                self.active_sessions[event_code]["dg_stt"] = None

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

    def disconnect_participant(self, websocket: WebSocket, event_code: str, target_lang: str):
        if event_code in self.active_sessions:
            try:
                self.active_sessions[event_code]["participants"][target_lang].remove(websocket)
                asyncio.create_task(self._update_host_participant_count(event_code))
            except (ValueError, KeyError):
                pass

    # ── Deepgram Streaming Pipeline ───────────────────────────────────────

    async def start_deepgram_stream(self, event_code: str, rate: int = 16000, lang: str = "tr"):
        """
        Initialize a Deepgram Nova-3 streaming connection for this event.
        When Deepgram returns a finalized transcript, it triggers
        translation + TTS and broadcasts to all participants.
        """
        session = self.get_or_create_session(event_code)

        async def on_transcript(text: str, is_final: bool):
            """Called by DeepgramStreamingSTT when a transcript arrives."""
            if not is_final:
                await self._broadcast_interim(event_code, text)
            else:
                await self._broadcast_to_participants(event_code, text, source_lang=lang)

        stt = DeepgramStreamingSTT(
            on_transcript_callback=on_transcript,
            language=lang,
            sample_rate=rate,
        )
        await stt.start()
        session["dg_stt"] = stt
        return stt

    async def send_audio_to_deepgram(self, event_code: str, audio_bytes: bytes):
        """Forward raw audio from host to the Deepgram STT stream."""
        session = self.active_sessions.get(event_code)
        if not session:
            return
        dg_stt = session.get("dg_stt")
        if dg_stt:
            await dg_stt.send_audio(audio_bytes)

    # ── Legacy Whisper Pipeline (fallback) ────────────────────────────────

    async def broadcast_translations_whisper(self, event_code: str, audio_bytes: bytes, source_lang: str = "auto"):
        """
        Fallback: chunk-based Whisper transcription → translation → broadcast.
        Used when DEEPGRAM_API_KEY is not configured.
        """
        original_text = await transcribe_audio_whisper(audio_bytes)
        if not original_text.strip():
            return
        await self._broadcast_to_participants(event_code, original_text, source_lang)

    # ── Core broadcast logic (shared by both pipelines) ───────────────────

    async def _broadcast_interim(self, event_code: str, interim_text: str):
        """Send interim (live-typing) text to participants without translating."""
        session = self.active_sessions.get(event_code)
        if not session:
            return

        participants_dict = session["participants"]
        if not participants_dict:
            return

        message = json.dumps({
            "is_interim": True,
            "original": interim_text
        })

        # Broadcast to everyone immediately
        for target_lang, ws_list in participants_dict.items():
            dead = []
            for ws in ws_list:
                try:
                    await ws.send_text(message)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                try:
                    ws_list.remove(ws)
                except ValueError:
                    pass

    async def _broadcast_to_participants(self, event_code: str, original_text: str, source_lang: str = "auto"):
        """Translate final text, generate TTS audio, and send to all participants."""
        session = self.active_sessions.get(event_code)
        if not session:
            print(f"[BROADCAST] ✗ No session for {event_code}")
            return

        participants_dict = session["participants"]
        if not participants_dict:
            print(f"[BROADCAST] ✗ No participants in {event_code}")
            return

        langs = list(participants_dict.keys())
        counts = {l: len(ws) for l, ws in participants_dict.items() if ws}
        print(f"[BROADCAST] '{original_text[:50]}' → {counts}")

        async def translate_and_send(target_lang: str, websockets: List[WebSocket]):
            if not websockets:
                return

            # 1. Translate
            translated_text = await translate_text(original_text, source_lang, target_lang)

            # 2. Generate TTS audio (Deepgram Aura)
            audio_b64 = None
            tts_bytes = await synthesize_speech(translated_text, target_lang)
            if tts_bytes:
                audio_b64 = base64.b64encode(tts_bytes).decode("utf-8")

            # 3. Build message
            message = json.dumps({
                "is_interim": False,
                "original": original_text,
                "translated": translated_text,
                "target_lang": target_lang,
                "audio": audio_b64,  # base64 mp3 or null
            })

            # 4. Send to all participants of this language
            dead = []
            for ws in websockets:
                try:
                    await ws.send_text(message)
                except Exception:
                    dead.append(ws)

            # Clean up disconnected
            for ws in dead:
                try:
                    websockets.remove(ws)
                except ValueError:
                    pass

        tasks = []
        for target_lang, ws_list in participants_dict.items():
            if ws_list:
                tasks.append(translate_and_send(target_lang, list(ws_list)))

        if tasks:
            await asyncio.gather(*tasks)


manager = ConnectionManager()
