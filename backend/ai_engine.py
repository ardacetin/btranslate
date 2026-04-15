import os
import re
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

client = AsyncOpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY and OPENAI_API_KEY != "your-openai-api-key-here" else None

async def transcribe_audio(audio_bytes: bytes) -> str:
    if not client:
        return "This is a mocked transcription of the audio buffer."

    try:
        filename = "audio.webm"
        mime_type = "audio/webm"
        if len(audio_bytes) > 8 and b"ftyp" in audio_bytes[:12]:
            filename = "audio.mp4"
            mime_type = "audio/mp4"

        # Bypass OS hard disk — stream strictly from RAM
        file_tuple = (filename, audio_bytes, mime_type)

        response = await client.audio.transcriptions.create(
            model="whisper-1",
            file=file_tuple,
            temperature=0.0,
            # Discourage Whisper from generating filler on silent/ambient chunks
            prompt="Transcribe only what is clearly spoken. Do not add pleasantries, greetings, or filler words."
        )

        text = response.text.strip()
        lower_text = text.lower()

        # ── Hard-block list ─────────────────────────────────────────────────
        # Whisper commonly hallucinates these phrases on silence / ambient noise.
        # We reject them regardless of length.
        hard_block_phrases = [
            "thank you for watching", "thanks for watching",
            "thank you so much", "thank you very much",
            "thank you.", "thank you!", "thank you",
            "goodbye", "good bye", "bye bye", "see you next time",
            "see you in the next video", "don't forget to subscribe",
            "please like and subscribe", "please subscribe",
            "transcribed by", "otter.ai", "amara.org", "by amara",
            "altyazı", "abone ol", "beğen", "yorum yap",
            "müzik", "[müzik]", "(müzik)", "[music]", "(music)",
            "[silence]", "(silence)", "[sessizlik]",
            "♪", "[ silence ]", "[ music ]",
        ]
        for phrase in hard_block_phrases:
            if phrase in lower_text:
                print(f"[FILTER] Hallucination blocked: '{text[:50]}'")
                return ""

        # Drop very short / punctuation-only outputs
        if len(text) < 4:
            return ""
        if re.fullmatch(r'[\W\s]+', text):
            return ""

        # Drop repeated-word patterns (e.g. "ha ha ha ha ha")
        words = text.split()
        if len(words) >= 4 and len(set(w.lower() for w in words)) == 1:
            return ""

        return text

    except Exception as e:
        print(f"[ERROR] Transcription failed: {e}")
        return "Error transcribing audio."


async def translate_text(text: str, source_lang: str, target_lang: str) -> str:
    print(f"[INFO] Translating '{text[:30]}...' -> {target_lang}")
    if not client:
        return f"[Mock {target_lang}] {text}"

    try:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"You are a real-time simultaneous interpreter. "
                        f"Translate the following spoken text from {source_lang} to {target_lang}. "
                        f"Reply ONLY with the translated text. "
                        f"Do not add greetings, explanations, or filler."
                    )
                },
                {"role": "user", "content": text}
            ],
            temperature=0.2,
        )
        res = response.choices[0].message.content.strip()
        print(f"[SUCCESS] '{res[:30]}...'")
        return res
    except Exception as e:
        print(f"[ERROR] Translation failed: {e}")
        return f"Error translating to {target_lang}."
