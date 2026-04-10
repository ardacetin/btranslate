# Project: btranslate - Real-Time AI Translation Tool

## 1. Concept & Vibe
I want to build a real-time audio-to-text translation system for internal corporate events. 
- **Host Side:** Captures microphone audio, streams it to the server.
- **Backend:** Processes audio via AI (Speech-to-Text & Translation).
- **Participant Side:** Joins via a unique Event Code or QR, selects their language, and sees a scrolling live feed of the translated text.

## 2. Technical Stack (Preferred)
- **Frontend:** React or Streamlit (for speed and vibe coding friendliness).
- **Backend:** Python (FastAPI) with WebSockets for real-time communication.
- **AI Engines:** - OpenAI Whisper (for Speech-to-Text).
    - GPT-4o-mini or DeepL API (for fast translation).
- **Database:** Supabase or simple SQLite to manage session codes and transcripts.

## 3. Core Features & User Stories

### A. The Host Dashboard
- [ ] "Start Broadcast" button to initiate microphone access.
- [ ] Event Code generator (e.g., "TEAM-2024").
- [ ] Selection of the source language (e.g., Turkish).
- [ ] Real-time preview of the transcript to ensure it's working.

### B. The Participant Web App
- [ ] Simple landing page to enter "Event Code".
- [ ] Language Selector (Dropdown: English, German, French, Spanish, etc.).
- [ ] A "Live Feed" container: Large, readable text that auto-scrolls as new translations arrive.
- [ ] "Dark Mode" focus for low-light event halls.

### C. The Processing Engine
- [ ] Audio is captured in 3-5 second buffers.
- [ ] Use WebSockets (Socket.io) to push "translation chunks" to all connected clients simultaneously.
- [ ] Latency target: Under 2 seconds from speech to screen.

## 4. Implementation Steps for Antigravity
1. **Phase 1:** Setup a basic WebSocket server that can broadcast "Hello World" to multiple clients.
2. **Phase 2:** Integrate Browser MediaRecorder API to send audio blobs to the backend.
3. **Phase 3:** Connect OpenAI Whisper to convert blobs to text.
4. **Phase 4:** Add the translation layer and the "Participant UI" with language filtering.
5. **Phase 5:** Add QR code generation for the session URL.

## 5. Security & Internal Use
- Ensure the app can be hosted locally or on a private server.
- No need for complex auth; just a "Session Password" for the Host.