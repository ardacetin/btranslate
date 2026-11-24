'use strict';

/**
 * Central configuration. Everything reads from process.env with sane
 * defaults so the app boots even with a partial .env during development.
 */
require('dotenv').config();
const crypto = require('crypto');

// The placeholder shipped in old .env.example files. A server signing tokens
// with it lets anyone forge an admin JWT, so it is treated as "no secret".
const PLACEHOLDER_JWT_SECRET = 'change-me-to-a-long-random-string';
const MIN_JWT_SECRET_LENGTH = 32;
const DEFAULT_TIMEZONE = 'Europe/Istanbul';

function bool(v, def = false) {
  if (v === undefined || v === null || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (e) {
    return false;
  }
}

const rawTimezone = process.env.APP_TIMEZONE || DEFAULT_TIMEZONE;

/** Google's IdP certificate: inline (PEM or bare base64, \n allowed) or a file path. */
function readIdpCert() {
  const inline = process.env.SAML_IDP_CERT || '';
  if (inline.trim()) return inline.replace(/\\n/g, '\n').trim();
  const file = process.env.SAML_IDP_CERT_FILE || '';
  if (!file) return '';
  try {
    return require('fs').readFileSync(file, 'utf8').trim();
  } catch (e) {
    return '';
  }
}

const publicBaseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const samlIdpSsoUrl = process.env.SAML_IDP_SSO_URL || '';
const samlIdpEntityId = process.env.SAML_IDP_ENTITY_ID || '';
const samlIdpCert = readIdpCert();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 3000),
  // Interface to bind. CloudPanel/Nginx proxies to 127.0.0.1, so the Node
  // port is not reachable from outside by default. Use 0.0.0.0 only if you
  // really need direct access (e.g. testing from another LAN device).
  host: process.env.HOST || '127.0.0.1',
  // Zone used for every human-facing time (exports, history, logs) and for
  // what a "day" means in the history/log pickers. Storage is always UTC.
  appTimezone: isValidTimeZone(rawTimezone) ? rawTimezone : DEFAULT_TIMEZONE,

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: num(process.env.DB_PORT, 3306),
    name: process.env.DB_NAME || 'btranslate',
    // No 'root' fallback: the app should use its own least-privilege user.
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
  },

  auth: {
    // Validated by assertSecureConfig() when the server starts.
    jwtSecret: process.env.JWT_SECRET || '',
    jwtExpiresIn: '7d',
    // Only used by `npm run migrate` (first seed) and set-admin-password.
    // No default: a well-known password must never be seeded.
    adminPassword: process.env.ADMIN_PASSWORD || '',
    // The account ADMIN_PASSWORD manages. With ADMIN_PASSWORD set, .env is the
    // source of truth: the server syncs this account's password on every start.
    adminUsername: (process.env.ADMIN_USERNAME || 'admin').trim(),
  },

  // Google Workspace SAML sign-in for the admin panel. Enabled only when the
  // public URL and Google's IdP details (SSO URL, entity ID, certificate) are
  // all set. Only accounts added in the panel with an email on `emailDomain`
  // can sign in this way.
  sso: {
    enabled: Boolean(publicBaseUrl && samlIdpSsoUrl && samlIdpEntityId && samlIdpCert),
    publicBaseUrl,
    emailDomain: (process.env.SSO_EMAIL_DOMAIN || 'beykoz.edu.tr').toLowerCase().replace(/^@/, ''),
    idpSsoUrl: samlIdpSsoUrl,
    idpEntityId: samlIdpEntityId,
    idpCert: samlIdpCert,
    spEntityId: process.env.SAML_SP_ENTITY_ID || (publicBaseUrl ? `${publicBaseUrl}/api/auth/saml/metadata` : ''),
    acsUrl: publicBaseUrl ? `${publicBaseUrl}/api/auth/saml/acs` : '',
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    // Dedicated real-time speech-to-speech translation endpoint + model.
    realtimeUrl: process.env.OPENAI_REALTIME_URL || 'wss://api.openai.com/v1/realtime/translations',
    model: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-translate',
  },

  deepl: {
    apiKey: process.env.DEEPL_API_KEY || '',
    // Text translation REST API base. Auto-detected from the key (free/pro)
    // when left empty; override only if you use a custom/self-hosted proxy.
    apiUrl: process.env.DEEPL_API_URL || '',
    // Optional translated speech (browser text-to-speech on the participant).
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

/**
 * Startup checks for the HTTP server only (the migrate / set-admin-password
 * scripts load this config too but never sign tokens).
 *
 * Throws on a fatal problem (production with a missing/placeholder/short
 * JWT_SECRET). In development a missing or placeholder secret is replaced by a
 * random per-process one, so tokens simply stop working after a restart.
 * Returns a list of warnings for the caller to log.
 */
function assertSecureConfig() {
  const warnings = [];
  const secret = config.auth.jwtSecret;
  const isPlaceholder = !secret || secret === PLACEHOLDER_JWT_SECRET;
  const isShort = secret.length < MIN_JWT_SECRET_LENGTH;

  if (config.env === 'production') {
    if (isPlaceholder || isShort) {
      throw new Error(
        `JWT_SECRET is missing, the example placeholder, or shorter than ${MIN_JWT_SECRET_LENGTH} characters. ` +
          "Set a long random value in .env, e.g. `node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"`."
      );
    }
  } else if (isPlaceholder) {
    config.auth.jwtSecret = crypto.randomBytes(48).toString('base64url');
    warnings.push('JWT_SECRET is not set — using a random per-process secret (development only; tokens reset on restart).');
  } else if (isShort) {
    warnings.push(`JWT_SECRET is shorter than ${MIN_JWT_SECRET_LENGTH} characters — this would be refused in production.`);
  }

  if (!config.db.user) {
    warnings.push('DB_USER is empty — set the MySQL user for this app in .env.');
  }
  const ssoParts = [config.sso.publicBaseUrl, config.sso.idpSsoUrl, config.sso.idpEntityId, config.sso.idpCert];
  if (!config.sso.enabled && ssoParts.some(Boolean)) {
    warnings.push('Google SAML sign-in is partially configured and stays OFF: set PUBLIC_BASE_URL, SAML_IDP_SSO_URL, SAML_IDP_ENTITY_ID and SAML_IDP_CERT (or SAML_IDP_CERT_FILE).');
  }
  if (config.sso.enabled && !/^https:\/\//.test(config.sso.publicBaseUrl) && config.env === 'production') {
    warnings.push('PUBLIC_BASE_URL should be https:// — Google only posts SAML responses to secure URLs.');
  }
  if (rawTimezone !== config.appTimezone) {
    warnings.push(`APP_TIMEZONE "${rawTimezone}" is not a valid IANA time zone — using ${config.appTimezone}.`);
  }
  return warnings;
}

module.exports = config;
// Non-enumerable so the plain config object (and anything that dumps it)
// stays data-only.
Object.defineProperty(config, 'assertSecureConfig', { value: assertSecureConfig, enumerable: false });
