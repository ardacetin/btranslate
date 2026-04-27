import os
import re
import asyncio
import httpx
from openai import AsyncOpenAI
from deepgram import DeepgramClient, LiveTranscriptionEvents, LiveOptions
from dotenv import load_dotenv

load_dotenv()

# ── API Keys ─────────────────────────────────────────────────────────────────
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "")

openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None
dg_client = DeepgramClient(DEEPGRAM_API_KEY) if DEEPGRAM_API_KEY else None

# ── Deepgram Aura TTS voice map ──────────────────────────────────────────────
# Maps target language codes to the best available Aura voice model.
# Aura-2 supports: en, es, nl, fr, de, it, ja
# For unsupported languages, we fall back to English voice.
TTS_VOICE_MAP = {
    "en": "aura-2-asteria-en",
    "tr": "aura-2-asteria-en",   # Turkish not natively supported, fallback to EN
    "de": "aura-2-asteria-de",
    "fr": "aura-2-asteria-fr",
    "es": "aura-2-asteria-es",
    "ja": "aura-2-asteria-ja",
    "ar": "aura-2-asteria-en",   # Arabic not natively supported, fallback
    "ur": "aura-2-asteria-en",   # Urdu not natively supported, fallback
    "zh": "aura-2-asteria-en",   # Chinese not natively supported, fallback
}


# ═══════════════════════════════════════════════════════════════════════════════
# 1. DEEPGRAM NOVA-3 STREAMING STT
# ═══════════════════════════════════════════════════════════════════════════════

class DeepgramStreamingSTT:
    """
    Manages a persistent Deepgram WebSocket connection for real-time
    speech-to-text.  Audio bytes are pushed in, and a callback fires
    whenever a final transcript is ready.
    """

    def __init__(self, on_transcript_callback, language: str = "multi"):
        """
        Args:
            on_transcript_callback: async function(text: str) called with
                                    each finalized transcript.
            language: Deepgram language code. 'multi' enables automatic
                      multilingual detection.
        """
        self.callback = on_transcript_callback
        self.language = language
        self.connection = None
        self._running = False

    async def start(self):
        """Open the Deepgram live connection."""
        if not dg_client:
            print("[DG-STT] No Deepgram API key — running in mock mode")
            return

        try:
            self.connection = dg_client.listen.live.v("1")

            # ── Event handlers ────────────────────────────────────────────
            async def on_message(self_dg, result, **kwargs):
                """Called when Deepgram returns a transcription result."""
                sentence = result.channel.alternatives[0].transcript
                is_final = result.is_final
                speech_final = result.speech_final

                # Only process finalized transcripts to avoid duplicates
                if is_final and sentence.strip():
                    print(f"[DG-STT] Final: '{sentence[:60]}' (speech_final={speech_final})")
                    await self.callback(sentence.strip())

            async def on_error(self_dg, error, **kwargs):
                print(f"[DG-STT] Error: {error}")

            async def on_close(self_dg, close, **kwargs):
                print("[DG-STT] Connection closed")
                self._running = False

            self.connection.on(LiveTranscriptionEvents.Transcript, on_message)
            self.connection.on(LiveTranscriptionEvents.Error, on_error)
            self.connection.on(LiveTranscriptionEvents.Close, on_close)

            # ── Connection options ────────────────────────────────────────
            options = LiveOptions(
                model="nova-3",
                language=self.language,      # 'multi' for auto-detect
                smart_format=True,
                punctuate=True,
                interim_results=False,       # Only final results
                vad_events=True,             # Let Deepgram handle VAD
                endpointing=300,             # 300ms silence = end of utterance
                encoding="linear16",
                channels=1,
                sample_rate=16000,
            )

            if await self.connection.start(options):
                self._running = True
                print("[DG-STT] Connection opened successfully")
            else:
                print("[DG-STT] Failed to open connection")

        except Exception as e:
            print(f"[DG-STT] Failed to start: {e}")

    async def send_audio(self, audio_bytes: bytes):
        """Send raw audio bytes to Deepgram for processing."""
        if self.connection and self._running:
            try:
                await self.connection.send(audio_bytes)
            except Exception as e:
                print(f"[DG-STT] Send error: {e}")

    async def stop(self):
        """Close the Deepgram connection gracefully."""
        if self.connection:
            try:
                await self.connection.finish()
            except Exception:
                pass
            self._running = False
            print("[DG-STT] Stopped")


# ═══════════════════════════════════════════════════════════════════════════════
# 2. WHISPER FALLBACK (kept for backward compatibility / if no DG key)
# ═══════════════════════════════════════════════════════════════════════════════

MIN_AUDIO_BYTES = 3000

async def transcribe_audio_whisper(audio_bytes: bytes) -> str:
    """Legacy Whisper-based transcription (used only if DEEPGRAM_API_KEY is not set)."""
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
# 3. GPT-4o-mini TRANSLATION (unchanged)
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
    """
    Convert text to speech using Deepgram Aura REST API.
    Returns raw audio bytes (mp3) or None on failure.
    """
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
                print(f"[TTS] Generated {len(response.content)}B audio for '{text[:30]}...' ({voice_model})")
                return response.content
            else:
                print(f"[TTS] Error {response.status_code}: {response.text[:100]}")
                return None
    except Exception as e:
        print(f"[TTS] Failed: {e}")
        return None
