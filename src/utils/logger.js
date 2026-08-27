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

function line(level, msg) {
  return `[${stamp()}] [${level}] ${msg}`;
}

const logger = {
  info(msg) {
    const l = line('INFO', msg);
    record(l);
    console.log(l);
  },
  warn(msg) {
    const l = line('WARN', msg);
    record(l);
    console.warn(l);
  },
  error(msg, err) {
    const detail = err ? ` — ${err && err.message ? err.message : err}` : '';
    const l = line('ERROR', msg + detail);
    record(l);
    console.error(l);
  },
  debug(msg) {
    if (!isProd) console.log(line('DEBUG', msg));
  },
  recent(n = 100) {
    return ring.slice(-n).join('\n');
  },
};

module.exports = logger;
