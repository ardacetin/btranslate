import os
import json
import asyncio
import base64
import websockets
from typing import Callable
from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

# ── Dedicated Translation endpoint & model ────────────────────────────
# This is NOT the general-purpose /v1/realtime endpoint.
# /v1/realtime/translations uses the gpt-realtime-translate model,
# which is trained specifically for interpretation and CANNOT act as
# a chatbot, answer questions, or hallucinate assistant responses.
REALTIME_TRANSLATE_URL = "wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate"


class RealtimeTranslationSession:
    """
    Manages a persistent WebSocket connection to OpenAI's dedicated
    gpt-realtime-translate model via /v1/realtime/translations.

    Key differences from general-purpose /v1/realtime:
    - No system prompt / instructions (model ignores them)
    - No turn lifecycle (no response.create, no assistant turns)
    - Continuous audio in → continuous translated audio + transcript out
    - Session is configured via session.audio.output.language
    - Dynamic voice adaptation (follows speaker's tone/pitch)
    """

    def __init__(self, target_language: str, on_event_callback: Callable):
        self.target_language = target_language
        self.callback = on_event_callback
        self.ws = None
        self._running = False
        self._listen_task = None

    async def start(self):
        """Open the dedicated Translation WebSocket connection."""
        if not OPENAI_API_KEY:
            print("[REALTIME-TRANSLATE] No OpenAI API key — skipping")
            return

        headers = {
            "Authorization": f"Bearer {OPENAI_API_KEY}",
        }

        try:
            try:
                self.ws = await websockets.connect(
                    REALTIME_TRANSLATE_URL,
                    additional_headers=headers,
                    ping_interval=None,
                    ping_timeout=None,
                )
            except TypeError:
                self.ws = await websockets.connect(
                    REALTIME_TRANSLATE_URL,
                    extra_headers=headers,
                    ping_interval=None,
                    ping_timeout=None,
                )

            self._running = True

            # ── Configure the translation session ─────────────────────
            # The translation endpoint uses a completely different
            # session.update schema than general /v1/realtime.
            # - No "instructions", "modalities", "voice", "temperature"
            # - Configure via session.audio.output.language
            # - Optionally enable input transcription with gpt-realtime-whisper
            session_update = {
                "type": "session.update",
                "session": {
                    "audio": {
                        "input": {
                            "noise_reduction": {"type": "near_field"},
                        },
                        "output": {
                            "language": self.target_language,
                        },
                    },
                },
            }
            await self.ws.send(json.dumps(session_update))

            self._listen_task = asyncio.create_task(self._listen_loop())
            print(f"[REALTIME-TRANSLATE] ✓ Connected — target: {self.target_language}")

        except Exception as e:
            print(f"[REALTIME-TRANSLATE] Connection failed: {e}")
            self.ws = None

    async def _listen_loop(self):
        """Background task that listens for translation events."""
        try:
            async for message in self.ws:
                try:
                    data = json.loads(message)
                    event_type = data.get("type", "")

                    # ── Translated text transcript (delta) ─────────
                    if event_type == "session.output_transcript.delta":
                        delta = data.get("delta", "")
                        if delta:
                            await self.callback(self.target_language, {
                                "type": "session.output_transcript.delta",
                                "delta": delta,
                            })

                    # ── Translated audio (delta) ───────────────────
                    elif event_type == "session.output_audio.delta":
                        audio = data.get("delta", "")
                        if audio:
                            await self.callback(self.target_language, {
                                "type": "session.output_audio.delta",
                                "audio": audio,
                            })

                    # ── Source language transcript (delta) ──────────
                    elif event_type == "session.input_transcript.delta":
                        delta = data.get("delta", "")
                        if delta:
                            await self.callback(self.target_language, {
                                "type": "session.input_transcript.delta",
                                "delta": delta,
                            })

                    # ── Errors ─────────────────────────────────────
                    elif event_type == "error":
                        print(f"[REALTIME-TRANSLATE ERROR] {data}")
                        error_info = data.get("error", {})
                        if error_info.get("code") == "session_expired":
                            break

                except json.JSONDecodeError:
                    pass
                except Exception as e:
                    print(f"[REALTIME-TRANSLATE] Message error: {e}")

        except websockets.exceptions.ConnectionClosed as e:
            print(f"[REALTIME-TRANSLATE] Connection closed: {e}")
        except Exception as e:
            print(f"[REALTIME-TRANSLATE] Listen error: {e}")
        finally:
            self._running = False
            if self.ws:
                try:
                    await self.ws.close()
                except Exception:
                    pass

    async def send_audio(self, audio_bytes: bytes):
        """
        Send raw PCM16 audio bytes to the translation session.
        
        The translation endpoint expects continuous audio via
        session.input_audio_buffer.append (including silence between phrases).
        There is no response.create or turn management.
        """
        if self.ws and self._running:
            try:
                b64_audio = base64.b64encode(audio_bytes).decode('utf-8')
                event = {
                    "type": "session.input_audio_buffer.append",
                    "audio": b64_audio,
                }
                await self.ws.send(json.dumps(event))
            except Exception as e:
                print(f"[REALTIME-TRANSLATE] Send error: {e}")

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
        print(f"[REALTIME-TRANSLATE] Stopped for {self.target_language}")
