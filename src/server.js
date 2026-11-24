'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const db = require('./config/database');
const logger = require('./utils/logger');
const lifecycle = require('./utils/lifecycle');
const { attachWebSocket } = require('./websocket');

const authRoutes = require('./routes/auth');
const samlRoutes = require('./routes/saml');
const userRoutes = require('./routes/users');
const sessionRoutes = require('./routes/sessions');
const exportRoutes = require('./routes/exports');
const adminRoutes = require('./routes/admin');
const historyRoutes = require('./routes/history');
const logsRoutes = require('./routes/logs');
const settingsRoutes = require('./routes/settings');
const systemRoutes = require('./routes/system');
const logStore = require('./services/logStore');
const { syncEnvAdmin } = require('./services/envAdmin');

const app = express();

// Behind CloudPanel/Nginx: trust the proxy so rate-limit sees real client IPs
// and req.secure reflects X-Forwarded-Proto (used for HSTS below).
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));

// ── Security headers (lightweight, no extra dependency) ────────────────────
// Host header as used in the CSP's ws:/wss: sources. Validated so a forged
// Host cannot inject extra CSP directives; omitted when it looks odd.
const HOST_HEADER_RE = /^[A-Za-z0-9.-]+(:\d+)?$/;

function contentSecurityPolicy(req) {
  const host = String(req.headers.host || '');
  const wsSources = HOST_HEADER_RE.test(host) ? ` ws://${host} wss://${host}` : '';
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://*.google-analytics.com https://*.googletagmanager.com",
    // Explicit ws/wss sources: older Safari does not treat 'self' as covering
    // WebSocket URLs of the same host.
    `connect-src 'self'${wsSources} https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com`,
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ');
}

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  res.setHeader('Content-Security-Policy', contentSecurityPolicy(req));
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');
  // Only over HTTPS (Nginx sets X-Forwarded-Proto); HSTS over plain HTTP is
  // ignored by browsers anyway and would be wrong on a local dev setup.
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
});

// ── Rate limiting on the API surface ───────────────────────────────────────
// Cheap public reads (participant page, homepage "is it live?" poll every
// 15 s) are hit by hundreds of students who share one campus NAT IP, so they
// get their own, much higher bucket instead of the general API limit.
const PUBLIC_READ_RE = /^\/api\/sessions\/[^/]+(\/live)?\/?$/;
function isPublicRead(req) {
  return (req.method === 'GET' || req.method === 'HEAD') && PUBLIC_READ_RE.test(req.baseUrl + req.path);
}

const publicReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isPublicRead,
});
// Login: only failed attempts count, so a whole class of hosts signing in
// from one IP is not locked out while password guessing still is.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many attempts, please try again later.' },
});
// Password change: every attempt counts (it needs a valid token anyway).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' },
});

app.use('/api/', (req, res, next) => (isPublicRead(req) ? publicReadLimiter(req, res, next) : next()));
app.use('/api/', apiLimiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/change-password', authLimiter);
// Google sign-in. The assertion endpoint always answers with a redirect, so
// it uses the limiter that counts every request; the code exchange returns
// 4xx on failure, so failures-only counting works there.
app.use('/api/auth/saml/acs', authLimiter);
app.use('/api/auth/saml/exchange', loginLimiter);

// ── API routes ─────────────────────────────────────────────────────────────
app.use('/api/auth/saml', samlRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/history', historyRoutes); // date-based transcript history
app.use('/api/logs', logsRoutes); // date-based system logs (admin)
app.use('/api/settings', settingsRoutes); // admin-managed app settings
app.use('/api/system', systemRoutes); // admin: restart the process
app.use('/api/sessions', exportRoutes); // /api/sessions/:code/export
app.use('/api/sessions', sessionRoutes); // create, get, /config

// Unknown API routes get JSON, not the HTML 404 page.
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ── Static frontend (preserved from the original project) ──────────────────
const frontendDir = path.join(__dirname, '..', 'frontend');
// Admin panel bundle (built from panel/ with `npm run build:panel`). Asset file
// names are content-hashed, so they can be cached for a year.
app.use('/static/panel/assets', express.static(path.join(frontendDir, 'panel', 'assets'), {
  immutable: true,
  maxAge: '365d',
  fallthrough: false,
}));
app.use('/static', express.static(frontendDir));

app.get('/', (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));
app.get('/host', (req, res) => {
  // Always revalidate the shell so a new deploy's hashed assets are picked up.
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(frontendDir, 'panel', 'index.html'));
});
app.get('/participant', (req, res) => res.sendFile(path.join(frontendDir, 'participant.html')));
app.get('/favicon.ico', (req, res) => res.redirect(301, '/static/favicon.svg'));
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

// ── Error handler (must be registered last) ───────────────────────────────
// Rejected async handlers reach here via utils/asyncHandler. Client errors
// raised by body parsing (bad JSON, too large) keep their 4xx status; anything
// else is logged and answered with a generic 500 so nothing internal leaks.
// eslint-disable-next-line no-unused-vars
// Branded 404 for any other page (API 404s are JSON, handled above).
app.use((req, res) => res.status(404).sendFile(path.join(frontendDir, '404.html')));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err); // let Express abort the response
  const status = Number(err && (err.status || err.statusCode));
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: err.expose && err.message ? err.message : 'Bad request' });
  }
  logger.error(`Unhandled error on ${req.method} ${req.originalUrl.split('?')[0]}`, err);
  return res.status(500).json({ error: 'Internal error' });
});

// ── Boot ─────────────────────────────────────────────────────────────────
const server = http.createServer(app);
const wss = attachWebSocket(server);

async function start() {
  try {
    for (const w of config.assertSecureConfig()) logger.warn(w);
  } catch (e) {
    logger.error(`Refusing to start: ${e.message}`);
    process.exit(1);
  }

  // Persist logs to the DB and prune old rows on a schedule — set up even if
  // the DB is down right now: record() drops rows while it is unreachable and
  // resumes as soon as the pool reconnects.
  logger.setSink((level, message) => logStore.record(level, message));
  setInterval(() => { logStore.cleanup(); }, 24 * 60 * 60 * 1000).unref();

  try {
    await db.ping();
    logger.info(`MySQL connected (${config.db.host}:${config.db.port}/${config.db.name})`);
    await syncEnvAdmin().catch((e) => logger.error('Could not sync the .env admin account', e));
    await logStore.cleanup();
  } catch (e) {
    logger.error('MySQL connection failed — did you run `npm run migrate`?', e);
  }

  if (!config.deepl.apiKey) {
    logger.warn('DEEPL_API_KEY is empty — running without live translation until it is set.');
  }

  server.on('error', (e) => {
    logger.error(`HTTP server error (${config.host}:${config.port})`, e);
    process.exit(1);
  });
  server.listen(config.port, config.host, () => {
    logger.info(`BTranslate listening on ${config.host}:${config.port} (${config.env}, times in ${config.appTimezone})`);
  });
}

// ── Graceful shutdown ─────────────────────────────────────────────────────
// Used for SIGTERM/SIGINT, fatal errors and the admin "restart" button.
// server.close() alone never finishes while upgraded WebSocket sockets or
// keep-alive connections are open, so those are closed explicitly.
const SHUTDOWN_TIMEOUT_MS = 5000;
const WS_CLOSE_GRACE_MS = 1000;
let shuttingDown = false;

function closeWebSockets() {
  for (const ws of wss.clients) {
    try {
      ws.close(1001, 'Server restarting'); // 1001 = going away → clients reconnect
    } catch (e) {
      /* ignore */
    }
  }
  // Don't wait for slow/dead peers to finish the close handshake.
  setTimeout(() => {
    for (const ws of wss.clients) ws.terminate();
  }, WS_CLOSE_GRACE_MS).unref();
  wss.close();
}

function closeHttpServer() {
  return new Promise((resolve) => {
    server.close(() => resolve()); // also called (with an error) if not listening
    if (server.closeIdleConnections) server.closeIdleConnections();
    // Give in-flight requests a moment, then drop whatever is left.
    setTimeout(() => {
      if (server.closeAllConnections) server.closeAllConnections();
    }, WS_CLOSE_GRACE_MS).unref();
  });
}

async function gracefulShutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${reason} — shutting down`);

  setTimeout(() => {
    logger.warn('Graceful shutdown timed out — forcing exit');
    process.exit(exitCode);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  try {
    closeWebSockets();
    await closeHttpServer();
  } catch (e) {
    logger.error('Error while closing connections', e);
  }
  // Stop persisting log lines before the pool goes away.
  logger.setSink(null);
  await db.close().catch(() => {});
  process.exit(exitCode);
}

lifecycle.setShutdownHandler(gracefulShutdown);

process.on('SIGTERM', () => lifecycle.requestShutdown('SIGTERM received', 0));
process.on('SIGINT', () => lifecycle.requestShutdown('SIGINT received', 0));
process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection', reason));
// After an uncaught exception the process state is unknown: log it and exit
// non-zero; systemd (Restart=always) starts a fresh process.
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', err);
  if (err && err.stack) console.error(err.stack);
  lifecycle.requestShutdown('Uncaught exception', 1);
});

start();

module.exports = { app, server };
