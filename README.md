# B-Translate

Real-time AI-powered simultaneous translation platform for live events and conferences.

## What It Does

A speaker talks into a microphone. Participants join via QR code or event code on their phones, pick their language, and instantly see — and hear — the live translation in under 1 second.

## Architecture (V2)

```
Host Microphone
     │  (raw PCM 16kHz mono)
     ▼
  WebSocket
     │
     ▼
Deepgram Nova-3  ──→  STT (streaming, <300ms latency, built-in VAD)
     │
     ▼
 GPT-4o-mini     ──→  Context-aware translation
     │
     ▼
 Deepgram Aura   ──→  TTS (studio-quality audio, <250ms first byte)
     │
     ▼
  WebSocket
     │
     ▼
Participant Screen + Audio
```

> Falls back to OpenAI Whisper + browser TTS automatically if `DEEPGRAM_API_KEY` is not set.

## How It Works

1. **Host** creates a session, gets a QR code, starts broadcasting.
2. **Audio** is captured as raw PCM (16kHz, mono) and streamed continuously to the server.
3. **Deepgram Nova-3** transcribes speech in real-time with built-in VAD — no client-side silence detection needed, zero hallucination.
4. **GPT-4o-mini** translates each finalized transcript to every requested language (once per language, shared across listeners).
5. **Deepgram Aura** converts the translated text to studio-quality MP3 audio on the server.
6. **Participants** receive both text and audio via WebSocket. Audio plays automatically if enabled.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python, FastAPI, WebSockets |
| STT | Deepgram Nova-3 (streaming) / OpenAI Whisper (fallback) |
| Translation | OpenAI GPT-4o-mini |
| TTS | Deepgram Aura / Browser speechSynthesis (fallback) |
| Frontend | Vanilla HTML/CSS/JS |
| Auth | JWT + bcrypt |
| Hosting | Render.com (CI/CD via GitHub) |

## Supported Languages

English, Turkish, German, French, Spanish, Arabic, Urdu, Chinese, Japanese

## Quick Start

```bash
# 1. Clone & install
git clone https://github.com/ardacetin/btranslate.git
cd btranslate
pip install -r backend/requirements.txt

# 2. Set environment variables
export OPENAI_API_KEY="sk-..."
export DEEPGRAM_API_KEY="..."
export JWT_SECRET_KEY="your-secret"

# 3. Run
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000` in your browser.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key — powers GPT-4o-mini translation |
| `DEEPGRAM_API_KEY` | Recommended | Deepgram API key — powers Nova-3 STT + Aura TTS |
| `JWT_SECRET_KEY` | Yes | Secret for JWT token signing |
| `ADMIN_PASSWORD` | No | Initial admin password (defaults to `admin123`) |

> Get a free Deepgram key at [console.deepgram.com](https://console.deepgram.com/signup) — includes $200/month free credit.

## Project Structure

```
btranslate/
├── backend/
│   ├── main.py          # FastAPI routes & WebSocket endpoints
│   ├── ai_engine.py     # Deepgram STT/TTS, Whisper fallback, GPT translation
│   ├── sockets.py       # Connection manager & broadcast pipeline
│   ├── auth.py          # JWT authentication
│   └── requirements.txt
└── frontend/
    ├── index.html        # Landing page (Join as participant)
    ├── host.html         # Host dashboard (QR, broadcast controls)
    ├── participant.html  # Live feed (text + audio)
    ├── styles.css        # Design system
    └── lang.js           # i18n (EN/TR)
```

## License

This project is licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).

**Beykoz University — IT Directorate**