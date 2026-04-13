from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, List, Set
import json
import asyncio
from ai_engine import transcribe_audio, translate_text

# Structure: { event_code: { "host": WebSocket, "participants": { lang_code: [WebSocket, ...] } } }
class ConnectionManager:
    def __init__(self):
        self.active_sessions: Dict[str, Dict] = {}

    def get_or_create_session(self, event_code: str):
        if event_code not in self.active_sessions:
            self.active_sessions[event_code] = {
                "host": None,
                "participants": {}
            }
        return self.active_sessions[event_code]

    async def connect_host(self, websocket: WebSocket, event_code: str):
        await websocket.accept()
        session = self.get_or_create_session(event_code)
        session["host"] = websocket

    def disconnect_host(self, event_code: str):
        if event_code in self.active_sessions:
            self.active_sessions[event_code]["host"] = None

    async def connect_participant(self, websocket: WebSocket, event_code: str, target_lang: str):
        await websocket.accept()
        session = self.get_or_create_session(event_code)
        if target_lang not in session["participants"]:
            session["participants"][target_lang] = []
        session["participants"][target_lang].append(websocket)

    def disconnect_participant(self, websocket: WebSocket, event_code: str, target_lang: str):
        if event_code in self.active_sessions:
            try:
                self.active_sessions[event_code]["participants"][target_lang].remove(websocket)
            except ValueError:
                pass

    async def broadcast_translations(self, event_code: str, audio_bytes: bytes, source_lang: str = "auto"):
        # 1. Transcribe audio to text
        original_text = await transcribe_audio(audio_bytes)
        if not original_text.strip() or "Error" in original_text:
            return

        session = self.active_sessions.get(event_code)
        if not session:
            return
        
        # 2. Translate and send to each target language group
        participants_dict = session["participants"]
        
        async def translate_and_send(target_lang: str, websockets: List[WebSocket]):
            if not websockets:
                return
            
            # Use original text if target is source or same (conceptually)
            # In a real app we would map 'en' properly, but let's just translate via prompt.
            translated_text = await translate_text(original_text, source_lang, target_lang)
            
            message = json.dumps({
                "original": original_text,
                "translated": translated_text,
                "target_lang": target_lang
            })
            
            # Send to all participants asking for this language
            for ws in websockets:
                try:
                    await ws.send_text(message)
                except Exception:
                    # Ignore disconnected clients for now
                    pass

        tasks = []
        for target_lang, ws_list in participants_dict.items():
            if ws_list:
                tasks.append(translate_and_send(target_lang, ws_list))
        
        if tasks:
            await asyncio.gather(*tasks)

manager = ConnectionManager()
