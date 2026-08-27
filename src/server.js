'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const db = require('./config/database');
const logger = require('./utils/logger');
const { attachWebSocket } = require('./websocket');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const sessionRoutes = require('./routes/sessions');
const exportRoutes = require('./routes/exports');
const adminRoutes = require('./routes/admin');

const app = express();

// Behind CloudPanel/Nginx: trust the proxy so rate-limit sees real client IPs.
app.set('trust proxy', 1);

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));

// ── Basic security headers (lightweight, no extra dependency) ──────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  next();
});

// ── Rate limiting on the API surface (esp. auth) ───────────────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' },
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);

// ── API routes ─────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/sessions', exportRoutes); // /api/sessions/:code/export
app.use('/api/sessions', sessionRoutes); // create, get, /config

// ── Static frontend (preserved from the original project) ──────────────────
const frontendDir = path.join(__dirname, '..', 'frontend');
app.use('/static', express.static(frontendDir));

app.get('/', (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));
app.get('/host', (req, res) => res.sendFile(path.join(frontendDir, 'host.html')));
app.get('/participant', (req, res) => res.sendFile(path.join(frontendDir, 'participant.html')));
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

// ── Boot ─────────────────────────────────────────────────────────────────
const server = http.createServer(app);
attachWebSocket(server);

async function start() {
  try {
    await db.ping();
    logger.info(`MySQL connected (${config.db.host}:${config.db.port}/${config.db.name})`);
  } catch (e) {
    logger.error('MySQL connection failed — did you run `npm run migrate`?', e);
  }

  if (!config.deepl.apiKey) {
    logger.warn('DEEPL_API_KEY is empty — running without live translation until it is set.');
  }

  server.listen(config.port, () => {
    logger.info(`BTranslate listening on port ${config.port} (${config.env})`);
  });
}

function shutdown(signal) {
  logger.info(`${signal} received — shutting down`);
  server.close(() => {
    db.close().finally(() => process.exit(0));
  });
  // Force exit if something hangs.
  setTimeout(() => process.exit(1), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection', reason));
process.on('uncaughtException', (err) => logger.error('Uncaught exception', err));

start();

module.exports = { app, server };
