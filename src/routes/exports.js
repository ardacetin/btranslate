'use strict';

const express = require('express');
const transcriptSvc = require('../services/transcript');

const router = express.Router();
const EVENT_CODE_RE = /^[A-Z0-9]{1,32}$/;

function fmtTime(d) {
  if (!d) return '';
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().replace('T', ' ').slice(0, 19);
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * GET /api/sessions/:code/export?format=txt|csv|json
 * Backend-generated export of FINAL segments. Format columns: time, original,
 * translation.
 */
router.get('/:code/export', async (req, res) => {
  const eventCode = String(req.params.code || '').toUpperCase();
  if (!EVENT_CODE_RE.test(eventCode)) return res.status(400).json({ error: 'Invalid code' });

  const format = String(req.query.format || 'txt').toLowerCase();
  let session = await transcriptSvc.getSessionByCode(eventCode);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const segments = await transcriptSvc.getSegments(session.id);
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
          started_at: fmtTime(session.started_at),
          ended_at: fmtTime(session.ended_at),
          segments: segments.map((s) => ({
            time: fmtTime(s.created_at),
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
    const lines = ['time,original,translation'];
    for (const s of segments) {
      lines.push([fmtTime(s.created_at), s.source_text, s.translated_text].map(csvEscape).join(','));
    }
    return res.send('﻿' + lines.join('\n')); // BOM for Excel/Turkish chars
  }

  // Default: TXT
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${base}.txt"`);
  const out = [];
  out.push(`Event: ${session.title} (Code: ${session.event_code})`);
  out.push(`Direction: ${session.source_language} -> ${session.target_language}`);
  out.push(`Started: ${fmtTime(session.started_at)}   Ended: ${fmtTime(session.ended_at)}`);
  out.push('-'.repeat(50), '');
  for (const s of segments) {
    out.push(`[${fmtTime(s.created_at)}] ${s.source_text}`);
    out.push(`    → ${s.translated_text}`, '');
  }
  return res.send(out.join('\n'));
});

module.exports = router;
