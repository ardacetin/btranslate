import os
from openai import AsyncOpenAI
from dotenv import load_dotenv
import tempfile

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

client = AsyncOpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY and OPENAI_API_KEY != "your-openai-api-key-here" else None

async def transcribe_audio(audio_bytes: bytes) -> str:
    if not client:
        # Mock mode if no key is provided
        return "This is a mocked transcription of the audio buffer."
    
    # Whisper requires a file-like object with a filename, we can use a temp file
    try:
        # Detect format from magic bytes
        suffix = ".webm"
        if len(audio_bytes) > 8 and b"ftyp" in audio_bytes[:12]:
            suffix = ".mp4"

        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp_audio:
            temp_audio.write(audio_bytes)
            temp_audio_path = temp_audio.name
        
        with open(temp_audio_path, "rb") as audio_file:
            response = await client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                temperature=0.0
            )
        os.remove(temp_audio_path)
        
        text = response.text.strip()
        lower_text = text.lower()
        
        # Whisper Hallucination Filter for silent/ambient chunks
        hallucinations = [
            "thank you.", "thank you", "thank you!", "you.",
            "thanks for watching", "thank you for watching", 
            "transcribed by", "otter.ai", "amara.org", "by amara",
            "thank you so much.", "please transcribe exactly",
            "what is said", "this is a real-time event",
            "subscribe", "comment", "like", "don't forget to",
            "thank you.", "thank you very much.", "abone",
            "hello, welcome to our event", "beğenmeyi", "yorum yap", 
            "amara", "altyazı", "see you in the next video",
            "[music]", "(music)", "♪", "müzik", "[müzik]", "(müzik)",
            "[silence]", "(silence)", "[sessizlik]", "(sessizlik)"
        ]
        
        if len(text) < 35 and any(h == lower_text or h in lower_text for h in hallucinations):
            return ""
            
        if "otter.ai" in lower_text or "amara.org" in lower_text:
            return ""

        return text
    except Exception as e:
        print(f"[ERROR] Transcription failed: {e}")
        return "Error transcribing audio."

async def translate_text(text: str, source_lang: str, target_lang: str) -> str:
    print(f"[INFO] Translating text '{text[:20]}...' to {target_lang}")
    if not client:
        return f"[Mock {target_lang}] {text}"
    
    try:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": f"You are a real-time translator. Translate the following text from {source_lang} to {target_lang}. Reply ONLY with the translated text without quotes or explanations."},
                {"role": "user", "content": text}
            ],
            temperature=0.3,
        )
        res = response.choices[0].message.content.strip()
        print(f"[SUCCESS] Translation output: '{res[:20]}...'")
        return res
    except Exception as e:
        print(f"[ERROR] Translation failed: {e}")
        return f"Error translating to {target_lang}."
