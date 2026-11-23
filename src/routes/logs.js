'use strict';

const express = require('express');
const logStore = require('../services/logStore');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { wrap } = require('../utils/asyncHandler');
const time = require('../utils/time');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// The admin panel shows at most this many rows on screen; exports get more.
const MAX_VIEW_ROWS = 2000;

/** Days (in APP_TIMEZONE) that have logs, newest first. */
router.get('/days', wrap(async (req, res) => {
  res.json(time.countsByLocalDay(await logStore.dayBuckets()));
}));

/** Log rows, optionally filtered by ?date=YYYY-MM-DD (local day) and ?level=. */
router.get('/', wrap(async (req, res) => {
  const date = req.query.date ? String(req.query.date) : null;
  const range = date ? time.localDayRange(date) : null;
  if (date && !range) return res.status(400).json({ error: 'Invalid date' });
  const limit = Math.min(MAX_VIEW_ROWS, Number(req.query.limit) || 500);
  const rows = await logStore.list({ ...range, level: req.query.level, limit });
  res.json(rows.map((r) => ({
    id: r.id,
    level: r.level,
    message: r.message,
    created_at: time.formatDateTime(r.created_at),
  })));
}));

/** Download a day's logs as TXT (oldest first, times in APP_TIMEZONE). */
router.get('/export', wrap(async (req, res) => {
  const date = String(req.query.date || '');
  const range = time.localDayRange(date);
  if (!range) return res.status(400).json({ error: 'Invalid date' });
  const rows = await logStore.list({ ...range, limit: logStore.MAX_LIST_ROWS });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="logs_${date}.txt"`);
  const lines = rows
    .slice()
    .reverse()
    .map((r) => `[${time.formatDateTime(r.created_at)}] [${r.level}] ${r.message}`);
  res.send(lines.join('\n'));
}));

module.exports = router;
