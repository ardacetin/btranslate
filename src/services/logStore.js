'use strict';

const db = require('../config/database');

/**
 * Persistent system log store (DB-backed) with automatic 30-day retention.
 *
 * `record()` is fire-and-forget and never throws — logging must not break the
 * request path, and if the DB is briefly unavailable we simply drop the row
 * (the console/ring-buffer copy still exists).
 */
const RETENTION_DAYS = 30;

function record(level, message) {
  // Fire-and-forget; swallow all errors (do NOT log from here — avoids loops).
  db.query('INSERT INTO system_logs (level, message) VALUES (?, ?)', [
    String(level || 'INFO').slice(0, 10),
    String(message || '').slice(0, 4000),
  ]).catch(() => {});
}

async function list({ date, level, limit = 500 } = {}) {
  const where = [];
  const params = [];
  if (date) {
    where.push('DATE(created_at) = ?');
    params.push(date);
  }
  if (level) {
    where.push('level = ?');
    params.push(String(level).toUpperCase());
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const lim = Math.min(2000, Math.max(1, Number(limit) || 500));
  return db.query(
    `SELECT id, level, message, created_at FROM system_logs ${clause} ORDER BY id DESC LIMIT ${lim}`,
    params
  );
}

async function days() {
  return db.query(
    `SELECT DATE(created_at) AS day, COUNT(*) AS count
       FROM system_logs GROUP BY DATE(created_at) ORDER BY day DESC`
  );
}

async function cleanup() {
  try {
    const res = await db.query(
      'DELETE FROM system_logs WHERE created_at < (NOW() - INTERVAL ? DAY)',
      [RETENTION_DAYS]
    );
    return res.affectedRows || 0;
  } catch (e) {
    return 0;
  }
}

module.exports = { record, list, days, cleanup, RETENTION_DAYS };
