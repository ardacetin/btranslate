'use strict';

const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const logger = require('../utils/logger');
const lifecycle = require('../utils/lifecycle');

const router = express.Router();

/**
 * Restart the app process. Works without root/sudo: under systemd
 * (Restart=always) or PM2, exiting makes the supervisor start a fresh process
 * within a few seconds. If the app was started manually (`npm start`) with no
 * supervisor, it will simply stop.
 *
 * Goes through the same graceful shutdown as SIGTERM (WebSocket clients get
 * close code 1001 so they reconnect, the DB pool is closed) with exit code 0.
 */
router.post('/restart', requireAuth, requireAdmin, (req, res) => {
  logger.warn(`Service restart requested from panel by ${req.user.sub}`);
  // Start shutting down only once the response has been flushed, so the
  // panel gets its { ok: true } before connections are closed.
  res.on('finish', () => {
    setImmediate(() => lifecycle.requestShutdown('restart requested from panel', 0));
  });
  res.json({ ok: true, message: 'restarting' });
});

module.exports = router;
