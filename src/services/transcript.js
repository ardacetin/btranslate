'use strict';

const db = require('../config/database');
const logger = require('../utils/logger');

/**
 * Persistence for FINAL transcript segments only. Tentative text is never
 * written to the database.
 */

async function getSessionByCode(eventCode) {
  const rows = await db.query('SELECT * FROM sessions WHERE event_code = ? LIMIT 1', [eventCode]);
  return rows[0] || null;
}

async function createOrGetSession(eventCode, { title, sourceLanguage, targetLanguage }) {
  const existing = await getSessionByCode(eventCode);
  if (existing) {
    // Re-activate and update direction/title on a fresh broadcast.
    await db.query(
      `UPDATE sessions
         SET title = ?, source_language = ?, target_language = ?,
             status = 'live', started_at = CURRENT_TIMESTAMP, ended_at = NULL
       WHERE id = ?`,
      [title, sourceLanguage, targetLanguage, existing.id]
    );
    return getSessionByCode(eventCode);
  }
  await db.query(
    `INSERT INTO sessions (event_code, title, source_language, target_language, status)
     VALUES (?, ?, ?, ?, 'live')`,
    [eventCode, title, sourceLanguage, targetLanguage]
  );
  return getSessionByCode(eventCode);
}

async function updateDirection(sessionId, sourceLanguage, targetLanguage) {
  await db.query('UPDATE sessions SET source_language = ?, target_language = ? WHERE id = ?', [
    sourceLanguage,
    targetLanguage,
    sessionId,
  ]);
}

async function endSession(sessionId) {
  await db.query(
    "UPDATE sessions SET status = 'ended', ended_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'live'",
    [sessionId]
  );
}

/**
 * Persist a single finalized segment.
 * @returns inserted row id, or null on failure.
 */
async function saveSegment(sessionId, seg) {
  try {
    const rows = await db.query(
      `INSERT INTO transcript_segments
         (session_id, source_text, translated_text, source_language, target_language, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        seg.sourceText,
        seg.translatedText,
        seg.sourceLanguage,
        seg.targetLanguage,
        seg.startedAt || null,
        seg.endedAt || null,
      ]
    );
    return rows.insertId;
  } catch (e) {
    logger.error('Failed to persist transcript segment', e);
    return null;
  }
}

async function getSegments(sessionId) {
  return db.query(
    'SELECT * FROM transcript_segments WHERE session_id = ? ORDER BY created_at ASC, id ASC',
    [sessionId]
  );
}

module.exports = {
  getSessionByCode,
  createOrGetSession,
  updateDirection,
  endSession,
  saveSegment,
  getSegments,
};
