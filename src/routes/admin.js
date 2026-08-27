'use strict';

const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Recent lifecycle/connection activity (no transcript/audio content).
router.get('/logs', requireAuth, requireAdmin, (req, res) => {
  res.json({ logs: logger.recent(100) || 'No activity yet.' });
});

module.exports = router;
