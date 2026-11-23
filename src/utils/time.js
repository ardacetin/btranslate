'use strict';

/**
 * Time-zone helpers.
 *
 * Storage rule: everything in MySQL is UTC. Every pool connection runs
 * `SET time_zone = '+00:00'` (see config/database.js), so CURRENT_TIMESTAMP,
 * NOW() and UTC_TIMESTAMP() agree, and mysql2 (`timezone: 'Z'`) reads and
 * writes DATETIME values as UTC.
 *
 * Presentation rule: anything a human reads (exports, history, logs) is shown
 * in config.appTimezone (APP_TIMEZONE, default Europe/Istanbul), and a
 * "day" picked in the UI means a local calendar day, translated here into a
 * UTC [start, end) range so queries stay sargable on the created_at indexes.
 */
const config = require('../config');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Bucket size used to count rows per local day: rows are grouped in SQL by
// 15-minute UTC buckets and then assigned to local days here. Every real-world
// UTC offset is a multiple of 15 minutes, so this is exact for any zone and
// stays correct across DST changes (unlike a fixed-offset CONVERT_TZ).
const DAY_BUCKET_SECONDS = 900;

const formatters = new Map();
function partsFormatter(timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function toDate(v) {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Wall-clock fields of `date` in `timeZone`, as zero-padded strings. */
function localParts(date, timeZone = config.appTimezone) {
  const out = {};
  for (const p of partsFormatter(timeZone).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  return out;
}

/** 'YYYY-MM-DD HH:mm:ss' in APP_TIMEZONE ('' for empty/invalid input). */
function formatDateTime(v) {
  const d = toDate(v);
  if (!d) return '';
  const p = localParts(d);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** 'HH:mm:ss' in APP_TIMEZONE. */
function formatTime(v) {
  const d = toDate(v);
  if (!d) return '';
  const p = localParts(d);
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** Local calendar day 'YYYY-MM-DD' in APP_TIMEZONE. */
function localDay(v) {
  const d = toDate(v);
  if (!d) return '';
  const p = localParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** UTC offset of `timeZone` at instant `date`, in minutes (Istanbul: +180). */
function offsetMinutes(date, timeZone = config.appTimezone) {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const wholeSeconds = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((asUtc - wholeSeconds) / 60000);
}

/** Parse a strict, real calendar date 'YYYY-MM-DD'; null when invalid. */
function parseDay(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return { y, m, d };
}

function isValidDay(s) {
  return parseDay(s) !== null;
}

// UTC instant of local midnight for the local date whose "as-if-UTC" epoch
// is `naiveMs`. Two passes so a DST change near midnight is handled.
function localMidnightToUtc(naiveMs) {
  let ts = naiveMs - offsetMinutes(new Date(naiveMs)) * 60000;
  ts = naiveMs - offsetMinutes(new Date(ts)) * 60000;
  return new Date(ts);
}

/**
 * Local day 'YYYY-MM-DD' (in APP_TIMEZONE) → { start, end } UTC Dates for a
 * half-open range: `created_at >= start AND created_at < end`.
 * Returns null for an invalid date.
 */
function localDayRange(day) {
  const p = parseDay(day);
  if (!p) return null;
  return {
    start: localMidnightToUtc(Date.UTC(p.y, p.m - 1, p.d)),
    end: localMidnightToUtc(Date.UTC(p.y, p.m - 1, p.d + 1)), // Date.UTC rolls over months/years
  };
}

/**
 * SQL expression for the day-bucket of a UTC DATETIME column. The session
 * time zone is +00:00, so UNIX_TIMESTAMP() treats the stored value as UTC.
 */
function dayBucketSql(column) {
  return `FLOOR(UNIX_TIMESTAMP(${column}) / ${DAY_BUCKET_SECONDS})`;
}

/**
 * Fold rows of { bucket, count } (from dayBucketSql) into
 * [{ day: 'YYYY-MM-DD', count }] by local day, newest first.
 */
function countsByLocalDay(rows) {
  const totals = new Map();
  for (const r of rows) {
    const day = localDay(new Date(Number(r.bucket) * DAY_BUCKET_SECONDS * 1000));
    if (!day) continue;
    totals.set(day, (totals.get(day) || 0) + Number(r.count || 0));
  }
  return [...totals.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([day, count]) => ({ day, count }));
}

module.exports = {
  DATE_RE,
  formatDateTime,
  formatTime,
  localDay,
  offsetMinutes,
  isValidDay,
  localDayRange,
  dayBucketSql,
  countsByLocalDay,
};
