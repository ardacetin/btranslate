'use strict';

const WebSocket = require('ws');
const config = require('../config');
const { LANGUAGES } = require('../config/languages');
const logger = require('../utils/logger');

/**
 * OpenAIRealtimeSession — backend-owned WebSocket to OpenAI's dedicated
 * real-time speech-to-speech translation endpoint (`/v1/realtime/translations`,
 * model `gpt-realtime-translate`). The API key stays on the server.
 *
 * Protocol (as used by BTranslate's original implementation):
 *   - Connect: wss://api.openai.com/v1/realtime/translations?model=<model>
 *     Header: Authorization: Bearer <OPENAI_API_KEY>
 *   - Configure: { type:'session.update', session:{ audio:{
 *       input:{ noise_reduction:{ type:'near_field' } },
 *       output:{ language:<targetLang> } } } }
 *   - Send audio: { type:'session.input_audio_buffer.append', audio:<base64 PCM16> }
 *   - Receive: session.input_transcript.delta (source text),
 *              session.output_transcript.delta (translated text),
 *              session.output_audio.delta (translated audio, base64 PCM16 24kHz)
 *
 * Emitted events via onEvent:
 *   { kind:'status', connected }  { kind:'reconnecting' }
 *   { kind:'transcript', text }   (source language)
 *   { kind:'translation', text }  (target language)
 *   { kind:'audio', base64 }      (translated speech)
 *   { kind:'error', message }
 */
class OpenAIRealtimeSession {
  constructor({ source, target, onEvent }) {
    this.source = source;
    this.target = target;
    this.onEvent = onEvent || (() => {});
    this.ws = null;
    this.connected = false;
    this.closedByUs = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
  }

  get enabled() {
    return Boolean(config.openai.apiKey);
  }

  _url() {
    const base = config.openai.realtimeUrl.replace(/\/+$/, '');
    return `${base}?model=${encodeURIComponent(config.openai.model)}`;
  }

  start() {
    if (!this.enabled) {
      logger.warn('OPENAI_API_KEY not set — OpenAI realtime engine unavailable.');
      this.onEvent({ kind: 'status', connected: false });
      return;
    }
    this.closedByUs = false;
    this._connect();
  }

  _connect() {
    let ws;
    try {
      ws = new WebSocket(this._url(), {
        headers: { Authorization: `Bearer ${config.openai.apiKey}` },
      });
    } catch (e) {
      logger.error('OpenAI realtime connect threw', e);
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on('open', () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      try {
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            audio: {
              input: { noise_reduction: { type: 'near_field' } },
              output: { language: LANGUAGES[this.target]?.labelEn || this.target },
            },
          },
        }));
      } catch (e) {
        logger.error('OpenAI session.update failed', e);
      }
      logger.info(`OpenAI realtime connected (${this.source}->${this.target}, ${config.openai.model})`);
      this.onEvent({ kind: 'status', connected: true });
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (e) { return; }
      const type = msg.type || '';
      if (type === 'session.input_transcript.delta') {
        if (msg.delta) this.onEvent({ kind: 'transcript', text: msg.delta });
      } else if (type === 'session.output_transcript.delta') {
        if (msg.delta) this.onEvent({ kind: 'translation', text: msg.delta });
      } else if (type === 'session.output_audio.delta') {
        const b64 = msg.delta || msg.audio;
        if (b64) this.onEvent({ kind: 'audio', base64: b64 });
      } else if (type === 'error') {
        logger.error(`OpenAI realtime error frame: ${JSON.stringify(msg).slice(0, 300)}`);
        this.onEvent({ kind: 'error', message: (msg.error && msg.error.message) || 'openai_error' });
      }
    });

    ws.on('unexpected-response', (req, res) => {
      let body = '';
      res.on('data', (c) => { if (body.length < 500) body += c.toString(); });
      res.on('end', () => {
        logger.error(`OpenAI realtime handshake rejected: HTTP ${res.statusCode}` + (body ? ` — ${body.slice(0, 300)}` : ''));
      });
    });

    ws.on('error', (err) => {
      logger.error(`OpenAI realtime error (${this._url()})`, err);
      this.onEvent({ kind: 'error', message: 'openai_ws_error' });
    });

    ws.on('close', (code) => {
      this.connected = false;
      logger.info(`OpenAI realtime disconnected (${this.source}->${this.target}) code=${code}`);
      this.onEvent({ kind: 'status', connected: false });
      if (!this.closedByUs) this._scheduleReconnect();
    });
  }

  _scheduleReconnect() {
    if (this.closedByUs) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(10000, 500 * 2 ** this.reconnectAttempts);
    this.onEvent({ kind: 'reconnecting' });
    logger.info(`OpenAI realtime reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this._connect(), delay);
  }

  sendAudio(buffer) {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({
        type: 'session.input_audio_buffer.append',
        audio: buffer.toString('base64'),
      }));
    } catch (e) { /* socket not ready */ }
  }

  stop() {
    this.closedByUs = true;
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      try { this.ws.close(); } catch (e) { /* ignore */ }
    }
    this.ws = null;
    this.connected = false;
  }
}

module.exports = { OpenAIRealtimeSession };
