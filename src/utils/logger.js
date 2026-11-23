'use strict';

/**
 * Controlled production logging.
 *
 * Rules (per project requirements):
 *  - Log lifecycle/connection events, not audio content.
 *  - Never log transcript/translation text at info level.
 *  - `debug()` is silent unless NODE_ENV !== 'production'.
 */
const isProd = (process.env.NODE_ENV || 'development') === 'production';

function stamp() {
  return new Date().toISOString();
}

// Small in-memory ring buffer so the admin dashboard can show recent activity
// without writing transcript content to disk.
const RING_SIZE = 200;
const ring = [];

function record(text) {
  ring.push(text);
  if (ring.length > RING_SIZE) ring.shift();
}

/**
 * Neutralize log injection: messages interpolate user-controlled values
 * (usernames, event titles, error text), and a CR/LF there could forge extra
 * log lines in journald / the DB log viewer. CR/LF become visible escapes,
 * TAB a space, and every other C0/C1 control, DEL, the Unicode line/paragraph
 * separators and bidi overrides become \uXXXX escapes.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
function sanitize(msg) {
  return String(msg ?? '').replace(UNSAFE_CHARS_RE, (ch) => {
    if (ch === '\n') return '\\n';
    if (ch === '\r') return '\\r';
    if (ch === '\t') return ' ';
    return `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
}

function line(level, msg) {
  return `[${stamp()}] [${level}] ${msg}`;
}

// Optional persistent sink (set at boot). Called as sink(level, message).
// Kept decoupled so logger has no DB dependency / import cycle.
let sink = null;
function toSink(level, msg) {
  if (!sink) return;
  try {
    sink(level, msg);
  } catch (e) {
    /* never let logging break the caller */
  }
}

const logger = {
  setSink(fn) {
    sink = typeof fn === 'function' ? fn : null;
  },
  info(raw) {
    const msg = sanitize(raw);
    const l = line('INFO', msg);
    record(l);
    toSink('INFO', msg);
    console.log(l);
  },
  warn(raw) {
    const msg = sanitize(raw);
    const l = line('WARN', msg);
    record(l);
    toSink('WARN', msg);
    console.warn(l);
  },
  error(raw, err) {
    const detail = err ? ` — ${err && err.message ? err.message : err}` : '';
    const msg = sanitize(String(raw ?? '') + detail);
    const l = line('ERROR', msg);
    record(l);
    toSink('ERROR', msg);
    console.error(l);
  },
  debug(msg) {
    if (!isProd) console.log(line('DEBUG', sanitize(msg)));
  },
  sanitize,
  recent(n = 100) {
    return ring.slice(-n).join('\n');
  },
};

module.exports = logger;
