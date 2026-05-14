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
                        f"You are an automated, emotionless translation machine. Your ONLY purpose is to translate the audio you hear into {self.target_language}. "
                        "CRITICAL RULES: "
                        "1. NEVER act as an assistant. NEVER greet the user. NEVER answer questions. NEVER converse. You are a PASSIVE TRANSLATOR ONLY. "
                        "2. If you hear silence, background noise, or nothing at all, you MUST remain completely silent. Do not invent text, do not say 'How can I help you', do not say 'Thanks for watching'. "
                        "3. Provide fast, simultaneous translation phrase-by-phrase. "
                        "4. NEVER translate proper nouns, human names, company names, brands, or technical acronyms (e.g., 'B-Translate', 'Beykoz Üniversitesi', 'Apple'). "
                        "5. Output ONLY the direct translation of the speaker's words."
                    ),
                    "voice": "alloy",
                    "temperature": 0.3,
                    "input_audio_format": "pcm16",
                    "output_audio_format": "pcm16",
                    "turn_detection": {
                        "type": "server_vad",
                        "threshold": 0.8,
                        "prefix_padding_ms": 300,
                        "silence_duration_ms": 400
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
                        text_delta = data.get("delta", "")
                        
                        # --- HALÜSİNASYON KARA LİSTESİ (Blacklist) ---
                        blacklist = ["yardımcı olabilirim", "nasıl yardımcı", "mutluluk duyarım", "how can i help", "thanks for watching", "izlediğiniz için teşekkürler", "subscribe", "abone ol", "www."]
                        text_lower = text_delta.lower()
                        
                        # If the delta alone is suspicious, or if we want to filter the whole stream, 
                        # checking delta directly might be tricky for partial words, but we can check if it matches exactly or contains obvious bad words.
                        # Actually, a better way is to check the delta. If a delta contains these phrases, drop it.
                        is_hallucination = any(bad_phrase in text_lower for bad_phrase in blacklist)
                        
                        if not is_hallucination:
                            await self.callback(self.target_language, {
                                "type": "session.output_transcript.delta",
                                "delta": text_delta
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
