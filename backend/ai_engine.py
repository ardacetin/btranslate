import os
import re
import json
import asyncio
import httpx
import websockets
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()

# ── API Keys ─────────────────────────────────────────────────────────────────
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "")

openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

# ── Deepgram Aura TTS voice map ──────────────────────────────────────────────
TTS_VOICE_MAP = {
    "en": "aura-2-asteria-en",
    "tr": "aura-2-asteria-en",
    "de": "aura-2-asteria-de",
    "fr": "aura-2-asteria-fr",
    "es": "aura-2-asteria-es",
    "ja": "aura-2-asteria-ja",
    "ar": "aura-2-asteria-en",
    "ur": "aura-2-asteria-en",
    "zh": "aura-2-asteria-en",
}


# ═══════════════════════════════════════════════════════════════════════════════
# 1. DEEPGRAM NOVA-3 STREAMING STT  (raw WebSocket — no SDK dependency)
# ═══════════════════════════════════════════════════════════════════════════════

class DeepgramStreamingSTT:
    """
    Manages a persistent Deepgram WebSocket connection for real-time
    speech-to-text using the raw WebSocket API (no SDK needed).
    """

    DEEPGRAM_WS_URL = "wss://api.deepgram.com/v1/listen"

    def __init__(self, on_transcript_callback, language: str = "multi"):
        self.callback = on_transcript_callback
        self.language = language
        self.ws = None
        self._running = False
        self._listen_task = None

    async def start(self):
        """Open the Deepgram WebSocket connection."""
        if not DEEPGRAM_API_KEY:
            print("[DG-STT] No Deepgram API key — running in mock mode")
            return

        params = (
            f"?model=nova-3"
            f"&language={self.language}"
            f"&smart_format=true"
            f"&punctuate=true"
            f"&interim_results=false"
            f"&vad_events=true"
            f"&endpointing=300"
            f"&encoding=linear16"
            f"&channels=1"
            f"&sample_rate=16000"
        )

        try:
            # websockets v14+ uses 'additional_headers', older uses 'extra_headers'
            try:
                self.ws = await websockets.connect(
                    f"{self.DEEPGRAM_WS_URL}{params}",
                    additional_headers={"Authorization": f"Token {DEEPGRAM_API_KEY}"},
                    ping_interval=20,
                    ping_timeout=10,
                )
            except TypeError:
                self.ws = await websockets.connect(
                    f"{self.DEEPGRAM_WS_URL}{params}",
                    extra_headers={"Authorization": f"Token {DEEPGRAM_API_KEY}"},
                    ping_interval=20,
                    ping_timeout=10,
                )
            self._running = True
            self._listen_task = asyncio.create_task(self._listen_loop())
            print("[DG-STT] Connection opened successfully")
        except Exception as e:
            print(f"[DG-STT] Failed to start: {e}")

    async def _listen_loop(self):
        """Background task that listens for Deepgram responses."""
        try:
            async for message in self.ws:
                try:
                    data = json.loads(message)
                    msg_type = data.get("type", "")

                    if msg_type == "Results":
                        is_final = data.get("is_final", False)
                        channel = data.get("channel", {})
                        alts = channel.get("alternatives", [])
                        if alts and is_final:
                            transcript = alts[0].get("transcript", "").strip()
                            if transcript:
                                print(f"[DG-STT] Final: '{transcript[:60]}'")
                                await self.callback(transcript)
                except json.JSONDecodeError:
                    pass
                except Exception as e:
                    print(f"[DG-STT] Message error: {e}")
        except websockets.exceptions.ConnectionClosed:
            print("[DG-STT] Connection closed")
        except Exception as e:
            print(f"[DG-STT] Listen error: {e}")
        finally:
            self._running = False

    async def send_audio(self, audio_bytes: bytes):
        """Send raw audio bytes to Deepgram."""
        if self.ws and self._running:
            try:
                await self.ws.send(audio_bytes)
            except Exception as e:
                print(f"[DG-STT] Send error: {e}")

    async def stop(self):
        """Close the Deepgram connection."""
        self._running = False
        if self.ws:
            try:
                # Send close message to Deepgram
                await self.ws.send(json.dumps({"type": "CloseStream"}))
                await self.ws.close()
            except Exception:
                pass
        if self._listen_task:
            self._listen_task.cancel()
        print("[DG-STT] Stopped")


# ═══════════════════════════════════════════════════════════════════════════════
# 2. WHISPER FALLBACK
# ═══════════════════════════════════════════════════════════════════════════════

MIN_AUDIO_BYTES = 3000

async def transcribe_audio_whisper(audio_bytes: bytes) -> str:
    """Legacy Whisper-based transcription (fallback if no DEEPGRAM_API_KEY)."""
    if not openai_client:
        return "This is a mocked transcription of the audio buffer."

    if len(audio_bytes) < MIN_AUDIO_BYTES:
        return ""

    try:
        filename = "audio.webm"
        mime_type = "audio/webm"
        if len(audio_bytes) > 8 and b"ftyp" in audio_bytes[:12]:
            filename = "audio.mp4"
            mime_type = "audio/mp4"

        file_tuple = (filename, audio_bytes, mime_type)

        response = await openai_client.audio.transcriptions.create(
            model="whisper-1",
            file=file_tuple,
            temperature=0.0,
            response_format="verbose_json",
        )

        segments = response.segments or []
        if not segments:
            return ""

        avg_no_speech = sum(getattr(s, 'no_speech_prob', 0) for s in segments) / len(segments)
        if avg_no_speech > 0.75:
            return ""

        text = response.text.strip()
        if len(text) < 4:
            return ""

        return text

    except Exception as e:
        print(f"[ERROR] Whisper transcription failed: {e}")
        return ""


# ═══════════════════════════════════════════════════════════════════════════════
# 3. GPT-4o-mini TRANSLATION
# ═══════════════════════════════════════════════════════════════════════════════

async def translate_text(text: str, source_lang: str, target_lang: str) -> str:
    if not openai_client:
        return f"[Mock {target_lang}] {text}"

    try:
        response = await openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"You are a real-time simultaneous interpreter. "
                        f"Translate the following spoken text from {'its original language' if source_lang == 'auto' else source_lang} to {target_lang}. "
                        f"IMPORTANT: The text might be an incomplete sentence fragment. Translate it exactly as it is, without trying to complete or fix the sentence. "
                        f"Reply ONLY with the translated text. Do not add any notes, greetings, or filler."
                    )
                },
                {"role": "user", "content": text}
            ],
            temperature=0.2,
        )
        res = response.choices[0].message.content.strip()
        print(f"[TRANSLATED] -> {target_lang}: '{res[:40]}...'")
        return res
    except Exception as e:
        print(f"[ERROR] Translation failed: {e}")
        return f"Error translating to {target_lang}."


# ═══════════════════════════════════════════════════════════════════════════════
# 4. DEEPGRAM AURA TTS
# ═══════════════════════════════════════════════════════════════════════════════

async def synthesize_speech(text: str, target_lang: str) -> bytes | None:
    """Convert text to speech using Deepgram Aura REST API."""
    if not DEEPGRAM_API_KEY:
        return None

    voice_model = TTS_VOICE_MAP.get(target_lang, "aura-2-asteria-en")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                "https://api.deepgram.com/v1/speak",
                headers={
                    "Authorization": f"Token {DEEPGRAM_API_KEY}",
                    "Content-Type": "application/json",
                },
                params={"model": voice_model, "encoding": "mp3"},
                json={"text": text},
            )
            if response.status_code == 200:
                print(f"[TTS] Generated {len(response.content)}B audio ({voice_model})")
                return response.content
            else:
                print(f"[TTS] Error {response.status_code}: {response.text[:100]}")
                return None
    except Exception as e:
        print(f"[TTS] Failed: {e}")
        return None
