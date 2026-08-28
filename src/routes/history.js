'use strict';

const express = require('express');
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fmtTime(d) {
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? '' : date.toTimeString().slice(0, 8);
}
function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Days that have transcript history, newest first. */
router.get('/days', async (req, res) => {
  const rows = await db.query(
    `SELECT DATE(created_at) AS day, COUNT(*) AS count
       FROM transcript_segments
      GROUP BY DATE(created_at)
      ORDER BY day DESC`
  );
  res.json(rows.map((r) => ({ day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10), count: r.count })));
});

/** Segments for one day (for the on-screen preview). */
router.get('/segments', async (req, res) => {
  const date = String(req.query.date || '');
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'Invalid date' });
  const rows = await db.query(
    `SELECT source_text, translated_text, source_language, target_language, created_at
       FROM transcript_segments
      WHERE DATE(created_at) = ?
      ORDER BY created_at ASC, id ASC`,
    [date]
  );
  res.json(rows.map((r) => ({
    time: fmtTime(r.created_at),
    original: r.source_text,
    translation: r.translated_text,
    source: r.source_language,
    target: r.target_language,
  })));
});

/** Download one day's history as TXT (default), CSV or JSON. */
router.get('/export', async (req, res) => {
  const date = String(req.query.date || '');
  const format = String(req.query.format || 'txt').toLowerCase();
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'Invalid date' });

  const rows = await db.query(
    `SELECT source_text, translated_text, source_language, target_language, created_at
       FROM transcript_segments
      WHERE DATE(created_at) = ?
      ORDER BY created_at ASC, id ASC`,
    [date]
  );

  const base = `history_${date}`;
  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.json"`);
    return res.send(JSON.stringify({
      date,
      count: rows.length,
      segments: rows.map((r) => ({ time: fmtTime(r.created_at), original: r.source_text, translation: r.translated_text })),
    }, null, 2));
  }
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
    const lines = ['time,original,translation'];
    for (const r of rows) lines.push([fmtTime(r.created_at), r.source_text, r.translated_text].map(csvEscape).join(','));
    return res.send('﻿' + lines.join('\n'));
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${base}.txt"`);
  const out = [`BTranslate — Transcript History`, `Date: ${date}`, `Segments: ${rows.length}`, '-'.repeat(50), ''];
  for (const r of rows) {
    out.push(`[${fmtTime(r.created_at)}] ${r.source_text}`);
    out.push(`    → ${r.translated_text}`, '');
  }
  res.send(out.join('\n'));
});

module.exports = router;
