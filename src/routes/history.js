'use strict';

const express = require('express');
const transcriptSvc = require('../services/transcript');
const { requireAuth } = require('../middleware/auth');
const { wrap } = require('../utils/asyncHandler');
const { toCsv } = require('../utils/csv');
const time = require('../utils/time');
const config = require('../config');

const router = express.Router();
router.use(requireAuth);

/**
 * A "day" here is a calendar day in APP_TIMEZONE; it is translated to a UTC
 * [start, end) range on created_at (stored in UTC, indexed by idx_created).
 * Returns { range, rows, truncated } or null for an invalid date.
 */
async function loadDay(date) {
  const range = time.localDayRange(date);
  if (!range) return null;
  const max = transcriptSvc.MAX_EXPORT_ROWS;
  const rows = await transcriptSvc.getSegmentsBetween(range.start, range.end, { limit: max + 1 });
  const truncated = rows.length > max;
  return { range, rows: truncated ? rows.slice(0, max) : rows, truncated };
}

/** Days (in APP_TIMEZONE) that have transcript history, newest first. */
router.get('/days', wrap(async (req, res) => {
  res.json(time.countsByLocalDay(await transcriptSvc.segmentDayBuckets()));
}));

/** Segments for one day (for the on-screen preview). */
router.get('/segments', wrap(async (req, res) => {
  const day = await loadDay(String(req.query.date || ''));
  if (!day) return res.status(400).json({ error: 'Invalid date' });
  if (day.truncated) res.setHeader('X-Truncated', 'true');
  res.json(day.rows.map((r) => ({
    time: time.formatTime(r.created_at),
    original: r.source_text,
    translation: r.translated_text,
    source: r.source_language,
    target: r.target_language,
  })));
}));

/** Download one day's history as TXT (default), CSV or JSON. */
router.get('/export', wrap(async (req, res) => {
  const date = String(req.query.date || '');
  const format = String(req.query.format || 'txt').toLowerCase();
  const day = await loadDay(date);
  if (!day) return res.status(400).json({ error: 'Invalid date' });
  const { rows, truncated } = day;
  if (truncated) res.setHeader('X-Truncated', 'true');

  const base = `history_${date}`;
  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.json"`);
    return res.send(JSON.stringify({
      date,
      timezone: config.appTimezone,
      count: rows.length,
      truncated,
      segments: rows.map((r) => ({
        time: time.formatTime(r.created_at),
        original: r.source_text,
        translation: r.translated_text,
      })),
    }, null, 2));
  }
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
    return res.send(toCsv(
      ['time', 'original', 'translation'],
      rows.map((r) => [time.formatTime(r.created_at), r.source_text, r.translated_text])
    ));
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${base}.txt"`);
  const out = [
    'BTranslate — Transcript History',
    `Date: ${date} (${config.appTimezone})`,
    `Segments: ${rows.length}${truncated ? ` (truncated to the first ${rows.length})` : ''}`,
    '-'.repeat(50),
    '',
  ];
  for (const r of rows) {
    out.push(`[${time.formatTime(r.created_at)}] ${r.source_text}`);
    out.push(`    → ${r.translated_text}`, '');
  }
  res.send(out.join('\n'));
}));

module.exports = router;
