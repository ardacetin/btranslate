'use strict';

const db = require('../config/database');
const { dayBucketSql } = require('../utils/time');

/**
 * Persistent system log store (DB-backed) with automatic 30-day retention.
 *
 * `record()` is fire-and-forget and never throws — logging must not break the
 * request path, and if the DB is briefly unavailable we simply drop the row
 * (the console/ring-buffer copy still exists).
 *
 * created_at is stored in UTC (the pool sets time_zone = '+00:00').
 */
const RETENTION_DAYS = 30;
const MAX_LIST_ROWS = 20000;

function record(level, message) {
  // Fire-and-forget; swallow all errors (do NOT log from here — avoids loops).
  db.query('INSERT INTO system_logs (level, message) VALUES (?, ?)', [
    String(level || 'INFO').slice(0, 10),
    String(message || '').slice(0, 4000),
  ]).catch(() => {});
}

/**
 * Newest-first log rows.
 * @param {object} opts
 * @param {Date}   [opts.start]  inclusive UTC lower bound on created_at
 * @param {Date}   [opts.end]    exclusive UTC upper bound on created_at
 * @param {string} [opts.level]  INFO / WARN / ERROR
 * @param {number} [opts.limit]  1..20000 (default 500)
 */
async function list({ start, end, level, limit = 500 } = {}) {
  const where = [];
  const params = [];
  // Range predicates (not DATE(created_at) = ?) so idx_logs_created is used
  // and the day boundaries follow APP_TIMEZONE instead of UTC.
  if (start) {
    where.push('created_at >= ?');
    params.push(start);
  }
  if (end) {
    where.push('created_at < ?');
    params.push(end);
  }
  if (level) {
    where.push('level = ?');
    params.push(String(level).toUpperCase());
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const lim = Math.min(MAX_LIST_ROWS, Math.max(1, Math.floor(Number(limit)) || 500));
  return db.query(
    `SELECT id, level, message, created_at FROM system_logs ${clause} ORDER BY id DESC LIMIT ${lim}`,
    params
  );
}

/** Raw per-bucket counts for the log day list (fold with time.countsByLocalDay). */
async function dayBuckets() {
  return db.query(
    `SELECT ${dayBucketSql('created_at')} AS bucket, COUNT(*) AS count
       FROM system_logs GROUP BY bucket`
  );
}

async function cleanup() {
  try {
    const res = await db.query(
      'DELETE FROM system_logs WHERE created_at < (UTC_TIMESTAMP() - INTERVAL ? DAY)',
      [RETENTION_DAYS]
    );
    return res.affectedRows || 0;
  } catch (e) {
    return 0;
  }
}

module.exports = { record, list, dayBuckets, cleanup, RETENTION_DAYS, MAX_LIST_ROWS };
