import os
import json
import asyncio
import base64
import websockets
from typing import Optional, Callable
from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
REALTIME_WS_URL = "wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate"

class RealtimeTranslationSession:
    """
    Manages a persistent WebSocket connection to OpenAI's GPT-Realtime-Translate model.
    """

    def __init__(self, target_language: str, on_event_callback: Callable):
        self.target_language = target_language
        self.callback = on_event_callback
        self.ws = None
        self._running = False
        self._listen_task = None
        self._bytes_sent = 0

    async def start(self):
        """Open the OpenAI Realtime Translation WebSocket connection."""
        if not OPENAI_API_KEY:
            print("[REALTIME] No OpenAI API key — skipping")
            return

        headers = {
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "OpenAI-Beta": "realtime=v1"
        }

        try:
            try:
                self.ws = await websockets.connect(
                    REALTIME_WS_URL,
                    additional_headers=headers,
                    ping_interval=None,
                    ping_timeout=None,
                )
            except TypeError:
                self.ws = await websockets.connect(
                    REALTIME_WS_URL,
                    extra_headers=headers,
                    ping_interval=None,
                    ping_timeout=None,
                )

            self._running = True
            
            # Send session.update
            session_update = {
                "type": "session.update",
                "session": {
                    "audio": {
                        "input": {
                            "transcription": {"model": "gpt-realtime-whisper"},
                            "noise_reduction": {"type": "near_field"}
                        },
                        "output": {"language": self.target_language}
                    }
                }
            }
            await self.ws.send(json.dumps(session_update))

            self._listen_task = asyncio.create_task(self._listen_loop())
            print(f"[REALTIME] ✓ Connected for target language: {self.target_language}")

        except Exception as e:
            print(f"[REALTIME] Connection failed: {e}")
            self.ws = None

    async def _listen_loop(self):
        """Background task that listens for OpenAI Realtime responses."""
        try:
            async for message in self.ws:
                try:
                    data = json.loads(message)
                    event_type = data.get("type", "")

                    if event_type in [
                        "session.output_transcript.delta",
                        "session.input_transcript.delta",
                        "session.output_audio.delta"
                    ]:
                        await self.callback(self.target_language, data)
                        
                    elif event_type == "error":
                        print(f"[REALTIME ERROR] {data}")

                except json.JSONDecodeError:
                    pass
                except Exception as e:
                    print(f"[REALTIME] Message error: {e}")

        except websockets.exceptions.ConnectionClosed as e:
            print(f"[REALTIME] Connection closed: {e}")
        except Exception as e:
            print(f"[REALTIME] Listen error: {e}")
        finally:
            self._running = False

    async def send_audio(self, audio_bytes: bytes):
        """Send raw audio bytes to OpenAI as a base64 encoded input buffer append."""
        if self.ws and self._running:
            try:
                b64_audio = base64.b64encode(audio_bytes).decode('utf-8')
                event = {
                    "type": "session.input_audio_buffer.append",
                    "audio": b64_audio
                }
                await self.ws.send(json.dumps(event))
            except Exception as e:
                print(f"[REALTIME] Send error: {e}")

    async def stop(self):
        """Close the connection."""
        self._running = False
        if self.ws:
            try:
                await self.ws.close()
            except Exception:
                pass
        if getattr(self, "_listen_task", None):
            self._listen_task.cancel()
        print(f"[REALTIME] Stopped for {self.target_language}")
