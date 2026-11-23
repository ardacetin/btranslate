'use strict';

const config = require('../config');
const { LANGUAGES } = require('../config/languages');
const logger = require('../utils/logger');

/**
 * DeepL text translation via the official REST API (/v2/translate).
 *
 * This is the real, generally-available DeepL developer API. The API key is
 * used ONLY here on the server and never reaches the browser.
 *
 *   Auth:  Authorization: DeepL-Auth-Key <key>
 *   Free keys end with ":fx" and use api-free.deepl.com; Pro keys use api.deepl.com.
 */
function apiBase() {
  if (config.deepl.apiUrl) return config.deepl.apiUrl.replace(/\/+$/, '');
  const key = config.deepl.apiKey || '';
  const isFree = key.endsWith(':fx');
  return isFree ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
}

// DeepL wants a region for English targets; other codes map straight through.
function targetCode(target) {
  const base = (LANGUAGES[target]?.deeplCode || target).toUpperCase();
  if (base === 'EN') return 'EN-US';
  return base;
}
function sourceCode(source) {
  return (LANGUAGES[source]?.deeplCode || source).toUpperCase();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Network errors, timeouts, rate limits and 5xx are worth another try. */
function isRetryable(err) {
  if (err.permanent) return false;
  return !err.status || err.status === 429 || err.status >= 500;
}

async function translateOnce(clean, source, target, timeoutMs) {
  const body = new URLSearchParams();
  body.set('text', clean);
  body.set('source_lang', sourceCode(source));
  body.set('target_lang', targetCode(target));

  let res;
  try {
    res = await fetch(`${apiBase()}/v2/translate`, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${config.deepl.apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      // Without a deadline a hung connection would stall translation for
      // minutes (Node's default socket timeout), freezing the live preview.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const err = new Error(e.name === 'TimeoutError' ? `DeepL timeout after ${timeoutMs}ms` : `DeepL request failed: ${e.message}`);
    throw err;
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`DeepL /v2/translate HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  return (data.translations && data.translations[0] && data.translations[0].text) || '';
}

/**
 * Translate one phrase. `retries` extra attempts are made (with jittered
 * exponential backoff) on timeouts, network errors, 429 and 5xx.
 */
async function translate(text, source, target, { timeoutMs = 5000, retries = 0 } = {}) {
  const clean = (text || '').trim();
  if (!clean) return '';
  if (!config.deepl.apiKey) {
    const err = new Error('DEEPL_API_KEY not set');
    err.permanent = true;
    throw err;
  }

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await translateOnce(clean, source, target, timeoutMs);
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      const delay = 300 * 2 ** attempt + Math.floor(Math.random() * 200);
      logger.warn(`DeepL attempt ${attempt + 1} failed (${err.status || 'network'}), retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
}

/** Lightweight connectivity/auth check used to report DeepL status. */
async function verify() {
  if (!config.deepl.apiKey) return false;
  try {
    await translate('merhaba', 'tr', 'en');
    logger.info('DeepL connected (text API verified)');
    return true;
  } catch (e) {
    logger.error('DeepL text API verification failed', e);
    return false;
  }
}

module.exports = { translate, verify };
