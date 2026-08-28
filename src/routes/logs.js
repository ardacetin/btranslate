'use strict';

const express = require('express');
const logStore = require('../services/logStore');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fmt(d) {
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().replace('T', ' ').slice(0, 19);
}

/** Days that have logs, newest first. */
router.get('/days', async (req, res) => {
  const rows = await logStore.days();
  res.json(rows.map((r) => ({
    day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
    count: r.count,
  })));
});

/** Log rows, optionally filtered by ?date=YYYY-MM-DD and ?level=. */
router.get('/', async (req, res) => {
  const date = req.query.date ? String(req.query.date) : null;
  if (date && !DATE_RE.test(date)) return res.status(400).json({ error: 'Invalid date' });
  const rows = await logStore.list({ date, level: req.query.level, limit: req.query.limit });
  res.json(rows.map((r) => ({ id: r.id, level: r.level, message: r.message, created_at: fmt(r.created_at) })));
});

/** Download a day's logs as TXT. */
router.get('/export', async (req, res) => {
  const date = String(req.query.date || '');
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'Invalid date' });
  const rows = await logStore.list({ date, limit: 2000 });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="logs_${date}.txt"`);
  const lines = rows
    .slice()
    .reverse()
    .map((r) => `[${fmt(r.created_at)}] [${r.level}] ${r.message}`);
  res.send(lines.join('\n'));
});

module.exports = router;
