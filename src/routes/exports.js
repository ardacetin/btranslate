'use strict';

const express = require('express');
const transcriptSvc = require('../services/transcript');
const { requireAuth } = require('../middleware/auth');
const { wrap } = require('../utils/asyncHandler');
const { toCsv } = require('../utils/csv');
const { formatDateTime } = require('../utils/time');
const config = require('../config');

const router = express.Router();
const EVENT_CODE_RE = /^[A-Z0-9]{1,32}$/;

/**
 * GET /api/sessions/:code/export?format=txt|csv|json
 * Backend-generated export of FINAL segments. Format columns: time, original,
 * translation. Times are shown in APP_TIMEZONE.
 *
 * Requires a signed-in host: an event code is short and guessable (the
 * default is LIVE), and the transcript of every broadcast ever held under it
 * must not be downloadable by anyone. Capped at MAX_EXPORT_ROWS rows; the
 * X-Truncated header (and a note in the file) says when the cap was hit.
 */
router.get('/:code/export', requireAuth, wrap(async (req, res) => {
  const eventCode = String(req.params.code || '').toUpperCase();
  if (!EVENT_CODE_RE.test(eventCode)) return res.status(400).json({ error: 'Invalid code' });

  const format = String(req.query.format || 'txt').toLowerCase();
  const session = await transcriptSvc.getSessionByCode(eventCode);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const max = transcriptSvc.MAX_EXPORT_ROWS;
  const fetched = await transcriptSvc.getSegments(session.id, { limit: max + 1 });
  const truncated = fetched.length > max;
  const segments = truncated ? fetched.slice(0, max) : fetched;
  if (truncated) res.setHeader('X-Truncated', 'true');
  const base = `transcript_${eventCode}`;

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.json"`);
    return res.send(
      JSON.stringify(
        {
          event: session.title,
          event_code: session.event_code,
          source_language: session.source_language,
          target_language: session.target_language,
          timezone: config.appTimezone,
          started_at: formatDateTime(session.started_at),
          ended_at: formatDateTime(session.ended_at),
          truncated,
          segments: segments.map((s) => ({
            time: formatDateTime(s.created_at),
            original: s.source_text,
            translation: s.translated_text,
          })),
        },
        null,
        2
      )
    );
  }

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
    return res.send(toCsv(
      ['time', 'original', 'translation'],
      segments.map((s) => [formatDateTime(s.created_at), s.source_text, s.translated_text])
    ));
  }

  // Default: TXT
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${base}.txt"`);
  const out = [];
  out.push(`Event: ${session.title} (Code: ${session.event_code})`);
  out.push(`Direction: ${session.source_language} -> ${session.target_language}`);
  out.push(`Started: ${formatDateTime(session.started_at)}   Ended: ${formatDateTime(session.ended_at)}   (${config.appTimezone})`);
  if (truncated) out.push(`Note: truncated to the first ${max} segments.`);
  out.push('-'.repeat(50), '');
  for (const s of segments) {
    out.push(`[${formatDateTime(s.created_at)}] ${s.source_text}`);
    out.push(`    → ${s.translated_text}`, '');
  }
  return res.send(out.join('\n'));
}));

module.exports = router;
