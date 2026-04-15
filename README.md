# B-Translate

Real-time AI-powered simultaneous translation platform for live events.

## What It Does

A speaker talks into a microphone. Participants join via QR code or event code on their phones, pick their language, and instantly see (and optionally hear) the live translation — under 3 seconds end-to-end.

## How It Works

```
Microphone → WebSocket → Whisper (Speech-to-Text) → GPT-4o-mini (Translation) → WebSocket → Participant Screen
```

1. **Host** creates a session, gets a QR code, starts broadcasting.
2. **Audio** is captured in 3-second chunks via the MediaRecorder API.
3. **Client-side VAD** filters silence before sending — saves API calls.
4. **Whisper** transcribes audio; `no_speech_prob` and hallucination filters block artifacts.
5. **GPT-4o-mini** translates to each requested language (once per language, shared across listeners).
6. **Participants** receive translations via WebSocket. Optional TTS reads them aloud.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python, FastAPI, WebSockets |
| AI | OpenAI Whisper-1, GPT-4o-mini |
| Frontend | Vanilla HTML/CSS/JS |
| Auth | JWT + bcrypt |
| Hosting | Render.com (CI/CD via GitHub) |

## Supported Languages

English, Turkish, German, French, Spanish, Arabic, Urdu, Chinese, Japanese

## Quick Start

```bash
# 1. Clone & install
git clone https://github.com/your-org/btranslate.git
cd btranslate
pip install -r backend/requirements.txt

# 2. Set environment variables
export OPENAI_API_KEY="sk-..."
export JWT_SECRET_KEY="your-secret"

# 3. Run
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000` in your browser.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key (required) |
| `JWT_SECRET_KEY` | Secret for JWT token signing |
| `ADMIN_PASSWORD` | Initial password for the 'admin' user (defaults to 'admin123') |

## Project Structure

```
btranslate/
├── backend/
│   ├── main.py          # FastAPI routes & WebSocket endpoints
│   ├── ai_engine.py     # Whisper transcription & GPT translation
│   ├── sockets.py       # Connection manager & broadcast logic
│   ├── auth.py          # JWT authentication
│   └── requirements.txt
└── frontend/
    ├── index.html        # Landing page
    ├── host.html         # Host dashboard
    ├── participant.html  # Live feed
    ├── styles.css        # Design system
    └── lang.js           # i18n (EN/TR)
```

## License

This project is licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).

**Beykoz University — IT Directorate**