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
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as temp_audio:
            temp_audio.write(audio_bytes)
            temp_audio_path = temp_audio.name
        
        with open(temp_audio_path, "rb") as audio_file:
            response = await client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file
            )
        os.remove(temp_audio_path)
        return response.text
    except Exception as e:
        print(f"Transcription error: {e}")
        return "Error transcribing audio."

async def translate_text(text: str, source_lang: str, target_lang: str) -> str:
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
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"Translation error: {e}")
        return f"Error translating to {target_lang}."
