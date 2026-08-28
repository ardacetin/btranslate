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

async function translate(text, source, target) {
  const clean = (text || '').trim();
  if (!clean) return '';
  if (!config.deepl.apiKey) throw new Error('DEEPL_API_KEY not set');

  const body = new URLSearchParams();
  body.set('text', clean);
  body.set('source_lang', sourceCode(source));
  body.set('target_lang', targetCode(target));

  const res = await fetch(`${apiBase()}/v2/translate`, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${config.deepl.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`DeepL /v2/translate HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  return (data.translations && data.translations[0] && data.translations[0].text) || '';
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
