'use strict';

const WebSocket = require('ws');
const config = require('../config');
const { LANGUAGES, GLOSSARY, resolveDirection } = require('../config/languages');
const logger = require('../utils/logger');

/**
 * DeepLVoiceSession — manages ONE backend-owned WebSocket to the DeepL Voice
 * real-time API for a single translation direction (source -> target).
 *
 * The browser NEVER talks to DeepL directly; the API key lives only here.
 *
 * ── Integration note ──────────────────────────────────────────────────────
 * DeepL's real-time voice streaming protocol is not (yet) broadly published
 * as a stable developer WebSocket spec. This class is written as a single,
 * well-isolated adapter:
 *   - `buildConfigMessage()` — the session-config frame we send on connect.
 *   - `sendAudio()`          — how raw PCM16 frames are forwarded.
 *   - `handleMessage()`      — normalizes whatever DeepL sends into our own
 *                              event shape ({kind:'transcript'|'translation'|
 *                              'audio'|...}).
 * When wiring against a real DeepL Voice account, adjust ONLY these three
 * methods to match the account's actual frame schema. The rest of the app
 * (VAD, sessions, export, UI) is provider-agnostic.
 *
 * Emitted events (via `onEvent(evt)`):
 *   { kind: 'status', connected: bool }
 *   { kind: 'reconnecting' }
 *   { kind: 'transcript',  final: bool, text }   // original-language transcript
 *   { kind: 'translation', final: bool, text }   // target-language translation
 *   { kind: 'audio', base64 }                    // translated speech (optional)
 *   { kind: 'error', message }
 */
class DeeplVoiceSession {
  constructor({ source, target, onEvent }) {
    this.source = source;
    this.target = target;
    this.onEvent = onEvent || (() => {});
    this.ws = null;
    this.connected = false;
    this.closedByUs = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.maxReconnectDelayMs = 10000;
  }

  get enabled() {
    return Boolean(config.deepl.apiKey);
  }

  buildConfigMessage() {
    const dir = resolveDirection(this.source, this.target);
    const glossary = dir ? GLOSSARY[dir.id] || {} : {};
    return {
      type: 'session.config',
      source_language: LANGUAGES[this.source]?.deeplCode || this.source.toUpperCase(),
      target_language: LANGUAGES[this.target]?.deeplCode || this.target.toUpperCase(),
      audio: {
        input_format: 'pcm_s16le',
        sample_rate: config.vad.sampleRate,
      },
      // Ask for translated speech only if enabled and the plan supports it.
      output_audio: config.deepl.enableTranslatedAudio,
      // Domain glossary (university terminology). Ignored by the server if
      // unsupported; harmless to include.
      glossary,
    };
  }

  start() {
    if (!this.enabled) {
      logger.warn('DeepL API key not set — DeepL Voice session not started (transcript/text path only).');
      this.onEvent({ kind: 'status', connected: false });
      return;
    }
    this.closedByUs = false;
    this._connect();
  }

  _connect() {
    let ws;
    try {
      ws = new WebSocket(config.deepl.voiceWsUrl, {
        headers: {
          // DeepL uses "DeepL-Auth-Key <key>" for REST; the realtime endpoint
          // is expected to accept the same scheme. Adjust if the account differs.
          Authorization: `DeepL-Auth-Key ${config.deepl.apiKey}`,
        },
      });
    } catch (e) {
      logger.error('DeepL Voice connect threw', e);
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on('open', () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      try {
        ws.send(JSON.stringify(this.buildConfigMessage()));
      } catch (e) {
        logger.error('Failed to send DeepL session config', e);
      }
      logger.info(`DeepL connected (${this.source}->${this.target})`);
      this.onEvent({ kind: 'status', connected: true });
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        // Some providers stream translated audio as raw binary frames.
        this.onEvent({ kind: 'audio', base64: Buffer.from(data).toString('base64') });
        return;
      }
      try {
        this.handleMessage(JSON.parse(data.toString()));
      } catch (e) {
        logger.debug('Non-JSON DeepL message ignored');
      }
    });

    // Handshake rejected with an HTTP response (404/401/403/...) — this is the
    // single most useful diagnostic when the endpoint/auth is wrong.
    ws.on('unexpected-response', (req, res) => {
      let body = '';
      res.on('data', (c) => { if (body.length < 500) body += c.toString(); });
      res.on('end', () => {
        logger.error(
          `DeepL handshake rejected: HTTP ${res.statusCode} from ${config.deepl.voiceWsUrl}` +
          (body ? ` — ${body.slice(0, 300)}` : '')
        );
      });
    });

    ws.on('error', (err) => {
      // e.g. ENOTFOUND (wrong host), ECONNREFUSED, TLS errors, 4xx handshakes
      logger.error(`DeepL error (${config.deepl.voiceWsUrl})`, err);
      this.onEvent({ kind: 'error', message: 'deepl_ws_error' });
    });

    ws.on('close', (code, reason) => {
      this.connected = false;
      const why = reason && reason.length ? ` — ${reason.toString().slice(0, 200)}` : '';
      logger.info(`DeepL disconnected (${this.source}->${this.target}) code=${code}${why}`);
      this.onEvent({ kind: 'status', connected: false });
      if (!this.closedByUs) this._scheduleReconnect();
    });
  }

  _scheduleReconnect() {
    if (this.closedByUs) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(this.maxReconnectDelayMs, 500 * 2 ** this.reconnectAttempts);
    this.onEvent({ kind: 'reconnecting' });
    logger.info(`DeepL reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this._connect(), delay);
  }

  /**
   * Normalize DeepL frames into our internal event shape. Tolerant of several
   * plausible field names so a small schema difference does not break the app.
   */
  handleMessage(msg) {
    const type = msg.type || msg.event || '';

    // Source-language (original) transcript
    if (/input.*transcript|transcript.*source|source.*transcript/i.test(type) || msg.transcript !== undefined) {
      const text = msg.text ?? msg.delta ?? msg.transcript ?? '';
      const final = Boolean(msg.is_final ?? msg.final ?? /final|concluded/i.test(type));
      if (text) this.onEvent({ kind: 'transcript', final, text });
      return;
    }

    // Target-language translation
    if (/translation|output.*transcript|translated.*text/i.test(type) || msg.translation !== undefined) {
      const text = msg.text ?? msg.delta ?? msg.translation ?? '';
      const final = Boolean(msg.is_final ?? msg.final ?? /final|concluded/i.test(type));
      if (text) this.onEvent({ kind: 'translation', final, text });
      return;
    }

    // Translated audio (base64)
    if (/audio/i.test(type)) {
      const b64 = msg.audio ?? msg.delta ?? msg.data ?? '';
      if (b64) this.onEvent({ kind: 'audio', base64: b64 });
      return;
    }

    if (/error/i.test(type)) {
      logger.error(`DeepL error frame: ${JSON.stringify(msg).slice(0, 300)}`);
      this.onEvent({ kind: 'error', message: msg.message || 'deepl_error' });
    }
  }

  /** Forward one PCM16 audio chunk (Buffer) to DeepL. */
  sendAudio(buffer) {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      // Sent as base64 inside a JSON frame. Switch to `this.ws.send(buffer)`
      // if the account expects raw binary audio frames instead.
      this.ws.send(
        JSON.stringify({ type: 'input_audio.append', audio: buffer.toString('base64') })
      );
    } catch (e) {
      logger.debug('sendAudio failed (socket not ready)');
    }
  }

  /** Signal the end of a speech segment so DeepL can finalize it. */
  markSpeechEnd() {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ type: 'input_audio.commit' }));
    } catch (e) {
      /* ignore */
    }
  }

  stop() {
    this.closedByUs = true;
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
        /* ignore */
      }
    }
    this.ws = null;
    this.connected = false;
  }
}

module.exports = { DeeplVoiceSession };
