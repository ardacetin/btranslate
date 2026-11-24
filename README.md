# BTranslate — Real-Time Turkish ⇄ English Translation

Real-time simultaneous translation for **Beykoz University** events. A speaker
talks into a microphone; participants open a page (via QR/event code) and see
the **live transcript**, the **translated text**, and — when enabled — hear the
**translated speech**, with the lowest latency practical.

- Türkçe → İngilizce and İngilizce → Türkçe, switchable with one button.
- Speech recognition runs in the host's browser and only emits on real speech;
  finalized phrases are additionally run through junk/hallucination filters.
- The DeepL API key lives **only on the server**; the browser talks only to our
  Node.js backend.

## Architecture

```
Host browser (Web Speech API)  ── live speech-to-text of the source language
      │  transcript phrases (interim + final) over WebSocket
      ▼
BTranslate Node.js backend (Express + ws)
      │  translates each phrase via the DeepL text API, filters, persists FINAL
      ▼
DeepL /v2/translate (REST, server-side)  ── key never leaves the server
      │
      ▼
Participants  ── live tentative text → final text → optional translated audio (browser TTS)
```

> **Why this design:** DeepL's real-time *voice* streaming is not a
> generally-available developer WebSocket API, so speech-to-text is done in the
> browser (Web Speech API) and DeepL is used for what it does provide — fast,
> high-quality **text** translation. The interface, sessions, export and
> security are unchanged.

### Tech stack

| Layer        | Technology                                   |
|--------------|----------------------------------------------|
| Backend      | Node.js, Express, `ws`                       |
| Database     | MySQL (`mysql2`), simple migrations          |
| STT          | Browser Web Speech API (Chrome/Edge)         |
| Translation  | DeepL text API `/v2/translate` (server-side) |
| TTS (opt.)   | Browser SpeechSynthesis on participants      |
| Admin panel  | React + [BoardUI](https://github.com/BoardUI/boardui) (React Aria, Tailwind v4), built with Vite |
| Public pages | Plain HTML/CSS/JS styled with BoardUI tokens (no bundle on phones) |
| Auth         | JWT (`jsonwebtoken`) + `bcryptjs`            |

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
    deeplText.js            # DeepL /v2/translate REST client (server-side only)
    sessionManager.js       # in-memory rooms, tentative/final assembly, broadcast
    users.js                # account queries + password/username rules
    transcript.js           # persistence of FINAL segments only
    filters.js              # hallucination / junk post-processing
  websocket/
    index.js                # upgrade routing, host auth, limits, heartbeat
    handlers.js             # host & participant socket handlers
  db/
    migrate.js              # `npm run migrate`
    migrations/001_init.sql
  utils/                    # logger (never logs audio/transcripts), asyncHandler, csv, time (UTC ↔ APP_TIMEZONE), lifecycle (graceful shutdown)
frontend/                   # index.html + landing.css, participant.html + styles.css, lang.js, 404.html, fonts/
  panel/                    # BUILT admin panel (committed output of panel/ — don't edit)
panel/                      # admin panel source (served at /host)
  src/components/           # BoardUI components (source, MIT — see LICENSE-BoardUI)
  src/styles/               # BoardUI tokens + type scale; src/index.css re-tints accent to maroon
  src/lib/                  # api client, broadcast controller (WS, speech, audio), helpers
  src/app/                  # shell, login, views (broadcast, history, users, logs, settings)
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

### Admin panel (BoardUI)

The `/host` admin panel is a React app built from BoardUI components
(`panel/`). Its **build output is committed** to `frontend/panel/`, so the
server needs no build tools — deploys stay `git pull` + restart. After changing
anything under `panel/`:

```bash
npm install               # dev dependencies (Vite, React, Tailwind, BoardUI deps)
npm run build:panel       # → frontend/panel/
npm run typecheck:panel   # optional
```

Commit the rebuilt `frontend/panel/` together with the source change. For live
editing run `npm run dev` (API on :3000) and `npm run dev:panel`, then open
`http://localhost:5173/static/panel/`.

The participant page stays plain HTML/JS for speed on phones and uses the same
BoardUI tokens (neutral palette, Inter, radii, shadows) and the same maroon
accent ramp (`frontend/styles.css`, `panel/src/index.css`).

The landing page (`frontend/index.html` + `frontend/landing.css`) follows the
[landing-page-design](https://github.com/elayadesign/ai-design-skills) system:
Geist, named text styles on the Tailwind type scale, a fixed spacing scale, flat
backgrounds, one motion curve and a word-by-word tagline reveal. Its copy lives
in `frontend/lang.js` (`lp_*` keys, English and Turkish). Fonts (Geist, Inter)
and icons (Phosphor, inlined SVG) are self-hosted; `frontend/og-image.png` is
the social sharing image. Unknown pages get the branded `frontend/404.html`.

**First admin login:** the first `npm run migrate` creates the `admin` account.
If `ADMIN_PASSWORD` is set (min. 8 characters, not `admin123`) it is used;
otherwise a strong random password is generated and **printed once** — store it.
`npm run set-admin-password` resets it later (reads `ADMIN_PASSWORD`, or prompts).

**Production refuses to start** without a `JWT_SECRET` of at least 32 characters
(the old placeholder value is rejected too).

## Database

`npm run migrate` is an idempotent runner: it creates the database if missing,
applies every `src/db/migrations/*.sql` file once (tracked in
`schema_migrations`), and seeds the admin user. To add schema changes, drop a
new numbered `.sql` file in that folder and re-run `npm run migrate`.

**Tables:** `sessions` (event, direction, status, timing), `transcript_segments`
(**final segments only** — tentative text is never stored), `users`.

## User management

Admins manage accounts from **Panel → Kullanıcılar**:

- **Create** an account with username, optional display name, password and role
  (`admin` / `user`). Passwords must be at least 8 characters and differ from
  the username.
- **Edit** display name and role, or **disable** an account instead of deleting
  it. A disabled user cannot sign in and their open sessions (including a live
  host WebSocket attempt) are rejected immediately.
- **Reset password** — signs the user out on every device.
- **Delete** an account.
- Guard rails: an admin cannot change their own role, disable or delete
  themselves, and the last active admin can never be demoted, disabled or
  deleted.
- Every signed-in user can change their own password via **Parolamı Değiştir**
  (requires the current password; other devices are signed out).

Each token is checked against the database on every request, so role changes,
disabling and password changes take effect without waiting for the 7-day token
expiry. Locked out? `npm run set-admin-password` resets the `admin` account's
password from `ADMIN_PASSWORD`, re-enables it and restores its admin role.

| Endpoint | Who | Purpose |
|----------|-----|---------|
| `GET /api/users` | admin | List accounts |
| `POST /api/users` | admin | Create `{ username, password?, email?, role, display_name }` (password or `@beykoz.edu.tr` email required) |
| `PATCH /api/users/:id` | admin | Update `{ display_name?, email?, role?, is_active? }` |
| `PUT /api/users/:id/password` | admin | Reset `{ new_password }` |
| `DELETE /api/users/:id` | admin | Delete |
| `GET /api/auth/me` | signed in | Current account |
| `POST /api/auth/change-password` | signed in | `{ current_password, new_password }` → fresh token |
| `GET /api/auth/saml/login` · `POST /api/auth/saml/acs` · `POST /api/auth/saml/exchange` | public | Google sign-in flow |
| `GET /api/auth/saml/metadata` | public | SP metadata for the Google Admin console |
| `GET /api/auth/saml/config` | admin | Values to enter in Google, what is missing |

## Google sign-in (SAML)

Admins and hosts can sign in to the panel with their **Google Workspace**
account. Only people an admin has added in **Kullanıcılar** with an
`@beykoz.edu.tr` email can do so. A Google account that is not in the panel,
is disabled, or is on another domain is refused. Password login stays
available, for example for the built-in `admin` account.

**1. Create the app in Google.** Google Admin console → *Apps* → *Web and
mobile apps* → *Add app* → *Add custom SAML app* (name it *B-Translate*). On
the *Google Identity Provider details* step, copy the **SSO URL** and the
**Entity ID**, and **download the certificate**.

**2. Service provider details.** The values are also shown, with copy
buttons, under *Panel → Ayarlar → Google ile giriş (SAML)*:

| Field | Value |
|---|---|
| ACS URL | `https://btranslate.beykoz.edu.tr/api/auth/saml/acs` |
| Entity ID | `https://btranslate.beykoz.edu.tr/api/auth/saml/metadata` |
| Name ID format | `EMAIL` |
| Name ID | *Basic Information › Primary email* |

Leave *Signed response* off; the assertion is always signed. No attribute
mapping is needed. Finally, set **User access** to *ON* for the organizational
units that should be able to use it.

**3. Configure the server** (`.env`), then restart:

```bash
PUBLIC_BASE_URL=https://btranslate.beykoz.edu.tr
SAML_IDP_SSO_URL=https://accounts.google.com/o/saml2/idp?idpid=XXXXXXX
SAML_IDP_ENTITY_ID=https://accounts.google.com/o/saml2?idpid=XXXXXXX
SAML_IDP_CERT_FILE=/home/btranslate/google-saml.pem
```

**4. Add people.** In *Kullanıcılar*, enter their institutional email. The
password is optional: without one, the account can only sign in with Google.

What is checked on every sign-in:

- the assertion is signed with Google's certificate;
- issuer and audience match;
- it answers a request this server issued in the last 10 minutes (Google
  app-launcher / IdP-initiated sign-in is therefore not accepted);
- it was never used before and is inside its validity window;
- the email is on `SSO_EMAIL_DOMAIN` and belongs to an active panel account.

The panel token is then handed over with a single-use 60-second code in the
URL fragment, never in a URL the server logs.

## Environment

See [`.env.example`](.env.example). Key variables:

| Variable | Description |
|----------|-------------|
| `PORT` | App port (behind Nginx). Never bind 80/443 directly. |
| `HOST` | Bind address, default `127.0.0.1` (Nginx proxies locally). `0.0.0.0` only for direct LAN access. |
| `APP_TIMEZONE` | Zone for displayed times and "days" in history/logs (default `Europe/Istanbul`). The DB stores UTC. |
| `DB_HOST/PORT/NAME/USER/PASSWORD` | MySQL connection. `DB_USER` is required (no `root` fallback). |
| `JWT_SECRET` | **Required in production**, ≥ 32 random chars: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `ADMIN_PASSWORD` | Optional initial admin password for the first migrate (else a random one is printed). |
| `PUBLIC_BASE_URL`, `SAML_IDP_SSO_URL`, `SAML_IDP_ENTITY_ID`, `SAML_IDP_CERT_FILE` / `SAML_IDP_CERT` | Google sign-in (see *Google sign-in (SAML)*). All four needed to turn it on. |
| `SSO_EMAIL_DOMAIN` | Email domain allowed for Google sign-in (default `beykoz.edu.tr`). |
| `DEEPL_API_KEY` | **Server-only.** Never sent to the browser. Free keys (`…:fx`) auto-use api-free.deepl.com. |
| `DEEPL_API_URL` | Optional REST base override (proxy). Auto-detected when empty. |
| `ENABLE_TRANSLATED_AUDIO` | `true`/`false` — offer spoken translation (browser TTS). |
| `FILTER_MIN_CHARS` / `FILTER_MIN_WORDS` | Reject too-short final segments. |
| `WS_MAX_CONNECTIONS_PER_IP` | WebSocket connections per client address (default 300 — a campus can share one NAT IP). |
| `WS_MAX_ROOMS` | Distinct event rooms open at once (default 50). |

### DeepL note

DeepL is used through its generally-available **text** API (`/v2/translate`),
isolated in **`src/services/deeplText.js`**. The key never leaves the server.
Speech-to-text runs in the host's browser (Web Speech API), so the host page is
best used in **Chrome or Edge**. If `DEEPL_API_KEY` is unset the app still runs —
the live transcript is shown and translation is simply skipped.

## Transcript export

Backend-generated, from **final** segments, with `time / original / translation`
(times in `APP_TIMEZONE`). **Requires a host login.** CSV cells starting with
`= + - @` are prefixed with `'` so Excel never runs them as formulas.

- `GET /api/sessions/:code/export?format=txt`
- `GET /api/sessions/:code/export?format=csv` (UTF-8 BOM for Excel)
- `GET /api/sessions/:code/export?format=json`

## Security

- Parameterized SQL (`mysql2` `execute`) everywhere; input validation on all routes.
- Text is rendered with `innerText` / escaped HTML (no XSS). A Content-Security-Policy,
  `Permissions-Policy`, HSTS (on HTTPS) and `nosniff` are sent; `X-Powered-By` is off.
  The admin page loads nothing from third parties (all code and fonts are bundled).
- Host JWTs (HS256, 7 days) are checked against the database on every request
  and WebSocket: deleted/disabled users and tokens issued before a password change
  are rejected immediately. The host WebSocket authenticates with its **first
  message**, so the token never appears in a URL or proxy log.
- Participants are receive-only (only keep-alive / audio opt-in messages are
  accepted); frames are capped at 64 KB; connections per IP and rooms are capped;
  slow clients get back-pressure instead of growing server memory.
- Rate limits: strict on login and password change, loose on the cheap public
  reads the participant/landing pages poll.
- The DeepL and OpenAI keys never leave the server. Logs record lifecycle /
  connection events only — **never audio content or transcript text** — and
  control characters are escaped so log lines can't be forged.

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

### Keeping the app running (process management)

If CloudPanel's Node.js site does not supervise the process for you (you have
to run `npm start` by hand), install the provided **systemd** unit so the app
runs in the background, restarts on crash, and starts on boot:

```bash
which node                        # note the absolute path
# edit deploy/btranslate.service if node is not at /usr/bin/node
sudo cp deploy/btranslate.service /etc/systemd/system/btranslate.service
sudo systemctl daemon-reload
sudo systemctl enable --now btranslate
sudo systemctl status btranslate  # verify
```

After updates: `git pull && npm run migrate && sudo systemctl restart btranslate`.

> **Upgrading from an earlier version:**
> - Set a real `JWT_SECRET` (≥ 32 chars) and `DB_USER` in `.env` first — the
>   server now refuses to start in production with the placeholder secret. Changing
>   the secret signs everyone out once.
> - Re-install the systemd unit (`sudo cp deploy/btranslate.service /etc/systemd/system/ && sudo systemctl daemon-reload`) for the new graceful-stop timeout.
> - Times are now stored in UTC. Rows written before this change used the MySQL
>   server's zone; if that was not UTC, older history/log times appear shifted by
>   that offset (a one-off `UPDATE … SET created_at = CONVERT_TZ(created_at, '+03:00', '+00:00')` fixes it).
> - Reload open host panels once: the host WebSocket protocol changed (old pages
>   still connect, but log a deprecation warning).
No sudo/root? Use PM2 instead: `pm2 start src/server.js --name btranslate`,
`pm2 save`, and a `@reboot pm2 resurrect` crontab entry.

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
