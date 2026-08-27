'use strict';

/**
 * Central configuration. Everything reads from process.env with sane
 * defaults so the app boots even with a partial .env during development.
 */
require('dotenv').config();

function bool(v, def = false) {
  if (v === undefined || v === null || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 3000),

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: num(process.env.DB_PORT, 3306),
    name: process.env.DB_NAME || 'btranslate',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  },

  auth: {
    jwtSecret: process.env.JWT_SECRET || 'change-me-to-a-long-random-string',
    jwtExpiresIn: '7d',
    adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  },

  deepl: {
    apiKey: process.env.DEEPL_API_KEY || '',
    voiceWsUrl: process.env.DEEPL_VOICE_WS_URL || 'wss://api.deepl.com/v1/voice/realtime',
    enableTranslatedAudio: bool(process.env.ENABLE_TRANSLATED_AUDIO, true),
  },

  // Delivered to the browser via GET /api/config (contains NO secrets).
  vad: {
    threshold: num(process.env.VAD_THRESHOLD, 0.015),
    minSpeechMs: num(process.env.VAD_MIN_SPEECH_MS, 250),
    silenceMs: num(process.env.VAD_SILENCE_MS, 800),
    // Audio format the browser must send and DeepL expects.
    sampleRate: 16000,
  },

  filters: {
    minChars: num(process.env.FILTER_MIN_CHARS, 2),
    minWords: num(process.env.FILTER_MIN_WORDS, 1),
  },
};

module.exports = config;
