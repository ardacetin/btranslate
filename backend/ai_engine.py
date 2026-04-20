import os
import re
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

client = AsyncOpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY and OPENAI_API_KEY != "your-openai-api-key-here" else None

# ── Minimum audio payload size (bytes) ──────────────────────────────────────
# Pure silence encodes to ~1-2 KB. Partial speech after a pause can be
# as small as 3-4 KB.  We keep the gate low to avoid dropping the first
# spoken chunk after a silence break.
MIN_AUDIO_BYTES = 3000


async def transcribe_audio(audio_bytes: bytes) -> str:
    if not client:
        return "This is a mocked transcription of the audio buffer."

    # ── Gate 1: reject tiny payloads (silence) before spending an API call ──
    if len(audio_bytes) < MIN_AUDIO_BYTES:
        print(f"[GATE] Audio too small ({len(audio_bytes)} B < {MIN_AUDIO_BYTES} B) — skipped")
        return ""

    try:
        filename = "audio.webm"
        mime_type = "audio/webm"
        if len(audio_bytes) > 8 and b"ftyp" in audio_bytes[:12]:
            filename = "audio.mp4"
            mime_type = "audio/mp4"

        file_tuple = (filename, audio_bytes, mime_type)

        # ── Use verbose_json to access no_speech_prob per segment ──────────
        response = await client.audio.transcriptions.create(
            model="whisper-1",
            file=file_tuple,
            temperature=0.0,
            response_format="verbose_json",
            # NOTE: Do NOT pass a `prompt` — it teaches Whisper the exact
            # filler phrases we want to avoid, making hallucination worse.
        )

        # ── Gate 2: check no_speech_prob on every segment ──────────────────
        # If Whisper itself thinks there was no speech, trust it.
        segments = response.segments or []
        if not segments:
            print("[GATE] Whisper returned zero segments — skipped")
            return ""

        avg_no_speech = sum(getattr(s, 'no_speech_prob', 0) for s in segments) / len(segments)
        if avg_no_speech > 0.75:
            print(f"[GATE] High no_speech_prob ({avg_no_speech:.2f}) — skipped")
            return ""

        text = response.text.strip()
        lower_text = text.lower()

        # ── Gate 3: smart-block known hallucination patterns ────────────────
        # Whisper often hallucinates these on silence. We should block them, 
        # but ONLY if they make up the majority of the text, to avoid dropping 
        # legitimate sentences like "I want to thank you all".
        hallucination_phrases = [
            "thank you for watching", "thanks for watching", "goodbye", "good bye",
            "bye bye", "see you next time", "don't forget to subscribe", "please subscribe",
            "like and subscribe", "please like and subscribe", "subscribe to my channel",
            "transcribed by", "otter.ai", "amara.org", "by amara",
            "subtitles by", "captions by", "copyright", 
            "abone olmayı unutmayın", "izlediğiniz için teşekkürler", "kanalima abone olun",
            "müzik", "[müzik]", "(müzik)", "[music]", "(music)", "music",
            "[silence]", "(silence)", "[sessizlik]", "(sessizlik)",
            "♪", "thank you", "thanks", "teşekkürler", "teşekkür ederim"
        ]
        
        # Check if the text is short and matches a hallucination exactly (or with punctuation)
        clean_text = re.sub(r'[^\w\s]', '', lower_text).strip()
        
        is_hallucination = False
        for phrase in hallucination_phrases:
            clean_phrase = re.sub(r'[^\w\s]', '', phrase.lower()).strip()
            # If the spoken text is exactly the hallucination
            if clean_text == clean_phrase:
                is_hallucination = True
                break
            # Or if it's very short and contains the hallucination
            if len(clean_text.split()) <= 5 and clean_phrase in clean_text:
                is_hallucination = True
                break
                
        if is_hallucination:
            print(f"[FILTER] Blocked as hallucination: '{text[:60]}'")
            return ""

        # ── Gate 4: reject very short / garbage output ─────────────────────
        if len(text) < 4:
            return ""
        if re.fullmatch(r'[\W\s]+', text):
            return ""

        # Repeated single word  ("ha ha ha ha")
        words = text.split()
        if len(words) >= 3 and len(set(w.lower() for w in words)) == 1:
            return ""

        print(f"[OK] '{text[:40]}...' (no_speech={avg_no_speech:.2f}, size={len(audio_bytes)}B)")
        return text

    except Exception as e:
        print(f"[ERROR] Transcription failed: {e}")
        return ""


async def translate_text(text: str, source_lang: str, target_lang: str) -> str:
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
                        f"Reply ONLY with the translated text. No additions."
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
