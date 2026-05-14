import os
import json
import asyncio
import base64
import websockets
from typing import Optional, Callable
from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
REALTIME_WS_URL = "wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview"

class RealtimeTranslationSession:
    """
    Manages a persistent WebSocket connection to OpenAI's GPT-Realtime model.
    """

    def __init__(self, target_language: str, on_event_callback: Callable):
        self.target_language = target_language
        self.callback = on_event_callback
        self.ws = None
        self._running = False
        self._listen_task = None

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
                    "modalities": ["audio", "text"],
                    "instructions": (
                        f"You are an expert, professional simultaneous translator. Translate the user's speech into {self.target_language}. "
                        "CRITICAL RULES: "
                        "1. Wait for complete sentences or meaningful phrases before translating to ensure perfect context and grammatical accuracy. "
                        "2. NEVER translate proper nouns, human names, company names, brands, or technical acronyms (e.g., 'B-Translate', 'Beykoz Üniversitesi', 'Apple'). Keep them exactly as spoken. "
                        "3. Do not answer questions or converse with the user. Output ONLY the translated text and audio. "
                        "4. Ensure the translation is natural, fluent, and highly professional."
                    ),
                    "voice": "alloy",
                    "input_audio_format": "pcm16",
                    "output_audio_format": "pcm16",
                    "input_audio_transcription": {
                        "model": "whisper-1"
                    },
                    "turn_detection": {
                        "type": "server_vad",
                        "threshold": 0.5,
                        "prefix_padding_ms": 300,
                        "silence_duration_ms": 800  # Cümle bitişini daha iyi anlaması için süreyi artırdık
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

                    if event_type == "response.audio_transcript.delta":
                        await self.callback(self.target_language, {
                            "type": "session.output_transcript.delta",
                            "delta": data.get("delta", "")
                        })
                    
                    elif event_type == "response.audio.delta":
                        await self.callback(self.target_language, {
                            "type": "session.output_audio.delta",
                            "audio": data.get("delta", "")
                        })
                        
                    elif event_type == "conversation.item.input_audio_transcription.completed":
                        await self.callback(self.target_language, {
                            "type": "session.input_transcript.delta",
                            "delta": data.get("transcript", "") + " "
                        })
                        
                    elif event_type == "error":
                        print(f"[REALTIME ERROR] {data}")
                        error_info = data.get("error", {})
                        if error_info.get("code") == "session_expired":
                            break

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
            if self.ws:
                asyncio.create_task(self.ws.close())

    async def send_audio(self, audio_bytes: bytes):
        """Send raw audio bytes to OpenAI as a base64 encoded input buffer append."""
        if self.ws and self._running:
            try:
                b64_audio = base64.b64encode(audio_bytes).decode('utf-8')
                event = {
                    "type": "input_audio_buffer.append",
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
