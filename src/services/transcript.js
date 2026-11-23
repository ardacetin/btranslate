'use strict';

const db = require('../config/database');
const logger = require('../utils/logger');
const { dayBucketSql } = require('../utils/time');

/**
 * Persistence for FINAL transcript segments only. Tentative text is never
 * written to the database.
 */

// Upper bound for a single export / day listing. A long event produces a few
// thousand segments; this keeps one request from loading an unbounded table
// into memory while comfortably covering real use.
const MAX_EXPORT_ROWS = 20000;

const SESSION_COLUMNS =
  'id, event_code, title, source_language, target_language, status, started_at, ended_at';
const SEGMENT_COLUMNS = 'id, source_text, translated_text, source_language, target_language, created_at';

async function getSessionByCode(eventCode) {
  const rows = await db.query(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE event_code = ? LIMIT 1`, [eventCode]);
  return rows[0] || null;
}

/**
 * Create the session row, or re-activate it (new title/direction, live again)
 * on a fresh broadcast. A single upsert on the UNIQUE event_code, so two
 * concurrent first requests for the same code cannot fail with ER_DUP_ENTRY.
 */
async function createOrGetSession(eventCode, { title, sourceLanguage, targetLanguage }) {
  await db.query(
    `INSERT INTO sessions (event_code, title, source_language, target_language, status, started_at, ended_at)
     VALUES (?, ?, ?, ?, 'live', CURRENT_TIMESTAMP, NULL)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title),
       source_language = VALUES(source_language),
       target_language = VALUES(target_language),
       status = 'live', started_at = CURRENT_TIMESTAMP, ended_at = NULL`,
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

// Callers may ask for MAX_EXPORT_ROWS + 1 rows to detect truncation.
function clampLimit(limit) {
  return Math.min(MAX_EXPORT_ROWS + 1, Math.max(1, Math.floor(Number(limit)) || MAX_EXPORT_ROWS));
}

/**
 * Segments of one session in chronological order, at most `limit` rows.
 * (LIMIT is inlined as a validated integer: mysql2 prepared statements reject
 * a bound LIMIT parameter on some MySQL versions.)
 */
async function getSegments(sessionId, { limit = MAX_EXPORT_ROWS } = {}) {
  return db.query(
    `SELECT ${SEGMENT_COLUMNS} FROM transcript_segments
      WHERE session_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ${clampLimit(limit)}`,
    [sessionId]
  );
}

/** Segments with start <= created_at < end (UTC Dates), chronological. */
async function getSegmentsBetween(start, end, { limit = MAX_EXPORT_ROWS } = {}) {
  return db.query(
    `SELECT ${SEGMENT_COLUMNS} FROM transcript_segments
      WHERE created_at >= ? AND created_at < ?
      ORDER BY created_at ASC, id ASC
      LIMIT ${clampLimit(limit)}`,
    [start, end]
  );
}

/** Raw per-bucket counts for the history day list (see utils/time.js). */
async function segmentDayBuckets() {
  return db.query(
    `SELECT ${dayBucketSql('created_at')} AS bucket, COUNT(*) AS count
       FROM transcript_segments
      GROUP BY bucket`
  );
}

module.exports = {
  getSessionByCode,
  createOrGetSession,
  updateDirection,
  endSession,
  saveSegment,
  getSegments,
  getSegmentsBetween,
  segmentDayBuckets,
  MAX_EXPORT_ROWS,
};
