'use strict';

const express = require('express');
const transcriptSvc = require('../services/transcript');
const { requireAuth } = require('../middleware/auth');
const { getDirection, resolveDirection, DIRECTIONS } = require('../config/languages');
const sessionManager = require('../services/sessionManager');
const config = require('../config');
const logger = require('../utils/logger');
const { wrap } = require('../utils/asyncHandler');

const router = express.Router();

const EVENT_CODE_RE = /^[A-Z0-9]{1,32}$/;

function resolveRequestedDirection(body) {
  // Accept either { direction: 'tr-en' } or { source, target } or legacy
  // { source_language }. Default to tr->en.
  if (body.direction) {
    const d = getDirection(body.direction);
    if (d) return d;
  }
  const source = body.source || body.source_language;
  const target = body.target || body.target_language;
  if (source && target) {
    const d = resolveDirection(source, target);
    if (d) return d;
  }
  return DIRECTIONS[0];
}

/** Public runtime config for the browser (no secrets). */
router.get('/config', (req, res) => {
  res.json({
    vad: config.vad,
    directions: DIRECTIONS,
    enableTranslatedAudio: config.deepl.enableTranslatedAudio,
  });
});

/** Create / (re)start a session. Host only. */
router.post('/', requireAuth, wrap(async (req, res) => {
  const title = String(req.body.event_name || req.body.title || 'Live Event').slice(0, 255);
  let eventCode = String(req.body.event_code || 'LIVE').toUpperCase();
  if (!EVENT_CODE_RE.test(eventCode)) eventCode = 'LIVE';

  const dir = resolveRequestedDirection(req.body);
  try {
    const session = await transcriptSvc.createOrGetSession(eventCode, {
      title,
      sourceLanguage: dir.source,
      targetLanguage: dir.target,
    });
    logger.info(`Session created via API: ${eventCode} (${dir.id}) by ${req.user.sub}`);
    res.json({
      event_code: session.event_code,
      event_name: session.title,
      source_language: session.source_language,
      target_language: session.target_language,
      direction: dir.id,
    });
  } catch (e) {
    logger.error('Create session error', e);
    res.status(500).json({ error: 'Failed to create session' });
  }
}));

/** Host: force all connected participants to reload (unfreeze their screens). */
router.post('/:code/refresh', requireAuth, (req, res) => {
  const eventCode = String(req.params.code || '').toUpperCase();
  if (!EVENT_CODE_RE.test(eventCode)) return res.status(400).json({ error: 'Invalid code' });
  const count = sessionManager.refreshClients(eventCode);
  res.json({ refreshed: count });
});

/** Public: is a broadcast currently live for this event? (homepage gating) */
router.get('/:code/live', (req, res) => {
  const eventCode = String(req.params.code || '').toUpperCase();
  if (!EVENT_CODE_RE.test(eventCode)) return res.status(400).json({ error: 'Invalid code' });
  res.json({ live: sessionManager.isLive(eventCode) });
});

/**
 * Public: fetch session info (used by participant page).
 *
 * Read-only: an unknown code returns defaults (status 'idle') instead of a
 * 404 so participants can open the page before the host starts, but it never
 * inserts a row — only an authenticated host (POST / or the host WebSocket)
 * creates sessions.
 */
router.get('/:code', wrap(async (req, res) => {
  const eventCode = String(req.params.code || '').toUpperCase();
  if (!EVENT_CODE_RE.test(eventCode)) return res.status(400).json({ error: 'Invalid code' });
  const session = await transcriptSvc.getSessionByCode(eventCode);
  if (!session) {
    return res.json({
      event_code: eventCode,
      event_name: 'Live Event',
      source_language: DIRECTIONS[0].source,
      target_language: DIRECTIONS[0].target,
      status: 'idle',
    });
  }
  res.json({
    event_code: session.event_code,
    event_name: session.title,
    source_language: session.source_language,
    target_language: session.target_language,
    status: session.status,
  });
}));

module.exports = router;
