# BTranslate — Real-Time Turkish ⇄ English Translation

Real-time simultaneous translation for **Beykoz University** events. A speaker
talks into a microphone; participants open a page (via QR/event code) and see
the **live transcript**, the **translated text**, and — when enabled — hear the
**translated speech**, with the lowest latency practical.

- Türkçe → İngilizce and İngilizce → Türkçe, switchable with one button.
- Browser **Voice Activity Detection (VAD)** so silence, music, applause and mic
  noise do not reach the translator (hallucination prevention).
- The DeepL API key lives **only on the server**; the browser talks only to our
  Node.js backend.

## Architecture

```
Browser microphone
      │  getUserMedia (echoCancellation, noiseSuppression, autoGainControl)
      ▼
Voice Activity Detection (browser)  ── only real speech is streamed
      │  PCM16 16 kHz mono over WebSocket
      ▼
BTranslate Node.js backend (Express + ws)
      │  manages the DeepL connection, applies filters, persists FINAL only
      ▼
DeepL Voice API (WebSocket)  ── transcript + translation (+ optional audio)
      │
      ▼
Participants  ── live tentative text → final text → optional translated audio
```

### Tech stack

| Layer        | Technology                          |
|--------------|-------------------------------------|
| Backend      | Node.js, Express, `ws`              |
| Database     | MySQL (`mysql2`), simple migrations |
| Translation  | DeepL Voice API (server-managed)    |
| Frontend     | Vanilla HTML/CSS/JS (preserved)     |
| Auth         | JWT (`jsonwebtoken`) + `bcryptjs`   |

### Project structure

```
src/
  server.js                 # Express app + HTTP server + WS attach + boot
  config/
    index.js                # env → typed config (no secrets leak to client)
    database.js             # mysql2 pool (parameterized queries only)
    languages.js            # central language registry + directions + glossary
  middleware/
    auth.js                 # JWT sign/verify, bcrypt, requireAuth/requireAdmin
  routes/
    auth.js  users.js  admin.js  sessions.js  exports.js
  services/
    deeplVoice.js           # the single DeepL Voice adapter (integration seam)
    sessionManager.js       # in-memory rooms, tentative/final assembly, broadcast
    transcript.js           # persistence of FINAL segments only
    filters.js              # hallucination / junk post-processing
  websocket/
    index.js                # upgrade routing + heartbeat
    handlers.js             # host & participant socket handlers
  db/
    migrate.js              # `npm run migrate`
    migrations/001_init.sql
  utils/logger.js           # controlled logging (never logs audio/transcripts)
frontend/                   # index.html, host.html, participant.html, styles.css, lang.js
.env.example
```

## Quick start

### Development

```bash
npm install
cp .env.example .env      # fill in DB_* , JWT_SECRET, DEEPL_API_KEY
npm run migrate           # creates the database, tables, and admin user
npm run dev               # http://localhost:3000
```

### Production

```bash
npm install --production
npm run migrate
npm start
```

Default host login after migration: **admin / `admin123`** (override with
`ADMIN_PASSWORD` before the first migrate, and change it from the dashboard).

## Database

`npm run migrate` is an idempotent runner: it creates the database if missing,
applies every `src/db/migrations/*.sql` file once (tracked in
`schema_migrations`), and seeds the admin user. To add schema changes, drop a
new numbered `.sql` file in that folder and re-run `npm run migrate`.

**Tables:** `sessions` (event, direction, status, timing), `transcript_segments`
(**final segments only** — tentative text is never stored), `users`.

## Environment

See [`.env.example`](.env.example). Key variables:

| Variable | Description |
|----------|-------------|
| `PORT` | App port (behind Nginx). Never bind 80/443 directly. |
| `DB_HOST/PORT/NAME/USER/PASSWORD` | MySQL connection. |
| `JWT_SECRET` | Long random string for host tokens. |
| `DEEPL_API_KEY` | **Server-only.** Never sent to the browser. |
| `DEEPL_VOICE_WS_URL` | DeepL realtime voice WebSocket endpoint. |
| `ENABLE_TRANSLATED_AUDIO` | `true`/`false` — speech output feature flag. |
| `VAD_THRESHOLD` | RMS energy threshold (0–1). Higher = less sensitive. |
| `VAD_MIN_SPEECH_MS` | Sustained speech before a segment starts (≈250). |
| `VAD_SILENCE_MS` | Silence before a segment ends (≈800). |
| `FILTER_MIN_CHARS` / `FILTER_MIN_WORDS` | Reject too-short final segments. |

VAD thresholds are delivered to the browser at runtime via `GET
/api/sessions/config`, so they can be tuned in `.env` without editing frontend
code.

### DeepL Voice integration note

DeepL's real-time voice streaming protocol is not yet a broadly published,
stable developer WebSocket spec. All DeepL-specific logic is isolated in
**`src/services/deeplVoice.js`** in three clearly marked methods:
`buildConfigMessage()`, `sendAudio()`, and `handleMessage()`. When connecting a
real DeepL Voice account, adjust **only** those to match the account's actual
frame schema and auth. Everything else (VAD, sessions, export, UI) is
provider-agnostic. If `DEEPL_API_KEY` is unset or the audio feature is
unsupported, the app still runs — live transcript and text translation continue
to work, and translated audio is simply skipped (feature detection).

## Transcript export

Backend-generated, from **final** segments, with `time / original / translation`:

- `GET /api/sessions/:code/export?format=txt`
- `GET /api/sessions/:code/export?format=csv` (UTF-8 BOM for Excel)
- `GET /api/sessions/:code/export?format=json`

## Security

Input validation on all routes; parameterized SQL (`mysql2` `execute`) against
injection; text is rendered with `innerText` (no HTML injection / XSS); rate
limiting on the API and stricter limits on login; the host WebSocket requires a
valid JWT during the upgrade handshake; participants are receive-only; the DeepL
key never leaves the server. Logs record lifecycle/connection events only —
**never audio content or transcript text**.

## CloudPanel deployment (btranslate.beykoz.edu.tr)

The app listens on `PORT` (e.g. `3000`) and is reverse-proxied by CloudPanel's
Nginx. It must **not** bind 80/443 directly.

1. **Create a Node.js site** in CloudPanel for `btranslate.beykoz.edu.tr` and
   deploy this repository (git clone or upload) into the site root.
2. **MySQL database:** in CloudPanel → *Databases*, create `btranslate` and a
   user; put the credentials in `.env`.
3. **Environment:** create `.env` from `.env.example` in the app root (set
   `NODE_ENV=production`, `PORT=3000`, DB\_\*, `JWT_SECRET`, `DEEPL_API_KEY`).
4. **Install & migrate:**
   ```bash
   npm install --production
   npm run migrate
   ```
5. **Startup command:** `npm start` (equivalently `node src/server.js`).
   Use CloudPanel's Node.js app manager to keep it running; if you prefer a
   process manager, `pm2 start src/server.js --name btranslate` works too — no
   extra layer is required.
6. **Reverse proxy + WebSocket:** CloudPanel's Nginx vhost must forward HTTP and
   upgrade WebSocket connections to the app. Ensure the proxy location includes
   the upgrade headers (CloudPanel's Node.js template usually does; verify):
   ```nginx
   location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_read_timeout 3600s;   # keep long-lived event sockets alive
   }
   ```
   `proxy_read_timeout` matters for multi-hour events. The single WS upgrade
   path (`/ws/...`) keeps this config simple.
7. **HTTPS:** issue a Let's Encrypt certificate in CloudPanel for the domain.
   `wss://` then works automatically (the frontend picks `wss:` on HTTPS pages),
   which is required for microphone access on the host page.

## Test scenarios

Validate against: (1) normal Turkish speech → English flows; (2) normal English
→ Turkish; (3) 10 s silence → no transcript; (4) music, (5) applause,
(6) mic-friction → no/near-no transcript (VAD + filters); (7) speech over hall
noise → detected; (8) English academic terms inside Turkish → preserved via the
glossary; (9) brief disconnect → auto-reconnect on both host and participant;
(10) 30–60 min run → heartbeat drops dead sockets, audio is a self-draining
queue, and only final segments hit the DB, so nothing accumulates.

Tune (3)–(7) with `VAD_THRESHOLD`, `VAD_MIN_SPEECH_MS`, `VAD_SILENCE_MS` and the
`FILTER_*` values.

## License

CC BY-NC-SA 4.0 — **Beykoz University, IT Directorate**.
