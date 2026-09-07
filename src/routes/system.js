'use strict';

const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Restart the app process. Works without root/sudo: under systemd
 * (Restart=always) or PM2, exiting makes the supervisor start a fresh process
 * within a few seconds. If the app was started manually (`npm start`) with no
 * supervisor, it will simply stop.
 */
router.post('/restart', requireAuth, requireAdmin, (req, res) => {
  logger.warn(`Service restart requested from panel by ${req.user.sub}`);
  res.json({ ok: true, message: 'restarting' });
  setTimeout(() => process.exit(0), 400);
});

module.exports = router;
