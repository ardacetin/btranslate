'use strict';

const db = require('../config/database');

/**
 * Application settings (key/value in the `settings` table), with defaults and
 * validation. Currently holds the host speech-segmentation tuning that decides
 * when a spoken phrase is finalized and sent for translation.
 */
const DEFAULTS = {
  // Voice engine: 'deepl' = browser speech recognition + DeepL text translation;
  // 'openai' = OpenAI real-time speech-to-speech (server audio).
  voice_engine: 'deepl',
  // Finalize the current phrase when it ends with sentence punctuation.
  flush_on_punctuation: true,
  // Finalize once the phrase reaches this many words (0 = disabled).
  max_words: 12,
  // Finalize after this much silence, ms (fallback so phrases always close).
  silence_ms: 500,
};

function clampInt(v, min, max, def) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function coerce(patch) {
  const out = {};
  if ('voice_engine' in patch) out.voice_engine = patch.voice_engine === 'openai' ? 'openai' : 'deepl';
  if ('flush_on_punctuation' in patch) out.flush_on_punctuation = Boolean(patch.flush_on_punctuation);
  if ('max_words' in patch) out.max_words = clampInt(patch.max_words, 0, 60, DEFAULTS.max_words);
  if ('silence_ms' in patch) out.silence_ms = clampInt(patch.silence_ms, 200, 5000, DEFAULTS.silence_ms);
  return out;
}

async function getAll() {
  const merged = { ...DEFAULTS };
  try {
    const rows = await db.query('SELECT `key`, value FROM settings');
    for (const r of rows) {
      if (!(r.key in DEFAULTS)) continue;
      try {
        merged[r.key] = JSON.parse(r.value);
      } catch (e) {
        /* ignore malformed row */
      }
    }
  } catch (e) {
    /* table missing / DB down → defaults */
  }
  return merged;
}

async function setMany(patch) {
  const clean = coerce(patch || {});
  for (const [key, value] of Object.entries(clean)) {
    await db.query(
      'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [key, JSON.stringify(value)]
    );
  }
  return getAll();
}

module.exports = { getAll, setMany, DEFAULTS };
