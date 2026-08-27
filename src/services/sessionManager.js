'use strict';

const { DeeplVoiceSession } = require('./deeplVoice');
const transcriptSvc = require('./transcript');
const { acceptFinalSegment, normalize } = require('./filters');
const { resolveDirection, LANGUAGES } = require('../config/languages');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * In-memory orchestration of live events. One entry per event_code holds the
 * host socket, participant sockets, the DeepL Voice session, the DB session
 * row, and the accumulators used to assemble FINAL segments from streamed
 * tentative deltas.
 *
 * Segment assembly model:
 *   - Every transcript/translation delta is appended to a per-segment buffer
 *     and broadcast to participants as TENTATIVE (faded) text.
 *   - When a FINAL translation arrives, the buffered source+translation are
 *     run through hallucination filters; if accepted, the segment is persisted
 *     (final only) and broadcast as FINAL. Buffers then reset.
 */
class SessionManager {
  constructor() {
    /** @type {Map<string, object>} */
    this.rooms = new Map();
  }

  _room(eventCode) {
    let room = this.rooms.get(eventCode);
    if (!room) {
      room = {
        eventCode,
        host: null,
        participants: new Set(),
        deepl: null,
        deeplConnected: false,
        dbSession: null,
        source: 'tr',
        target: 'en',
        buf: { source: '', translation: '', startedAt: null },
      };
      this.rooms.set(eventCode, room);
    }
    return room;
  }

  // ── Host lifecycle ────────────────────────────────────────────────────
  async startBroadcast(eventCode, ws, { title, source, target }) {
    const dir = resolveDirection(source, target);
    if (!dir) throw new Error('Unsupported translation direction');

    const room = this._room(eventCode);
    room.host = ws;
    room.source = source;
    room.target = target;

    room.dbSession = await transcriptSvc.createOrGetSession(eventCode, {
      title: title || 'Live Event',
      sourceLanguage: source,
      targetLanguage: target,
    });

    this._ensureDeepl(room);
    logger.info(`Session started: ${eventCode} (${source}->${target})`);

    this._sendHost(room, {
      type: 'config',
      vad: config.vad,
      source,
      target,
      audio: config.deepl.enableTranslatedAudio,
      deepl: room.deeplConnected,
    });
    this._broadcastDirection(room);
    this._broadcastParticipantCount(room);
    return room;
  }

  async setDirection(eventCode, source, target) {
    const room = this.rooms.get(eventCode);
    if (!room) return;
    const dir = resolveDirection(source, target);
    if (!dir) return;
    room.source = source;
    room.target = target;
    room.buf = { source: '', translation: '', startedAt: null };
    if (room.dbSession) {
      await transcriptSvc.updateDirection(room.dbSession.id, source, target);
    }
    // Restart DeepL with the new direction.
    if (room.deepl) room.deepl.stop();
    room.deepl = null;
    this._ensureDeepl(room);
    this._broadcastDirection(room);
    logger.info(`Direction changed: ${eventCode} -> ${source}->${target}`);
  }

  _ensureDeepl(room) {
    if (room.deepl) return;
    room.deepl = new DeeplVoiceSession({
      source: room.source,
      target: room.target,
      onEvent: (evt) => this._onDeeplEvent(room, evt),
    });
    room.deepl.start();
  }

  handleHostAudio(eventCode, buffer) {
    const room = this.rooms.get(eventCode);
    if (!room || !room.deepl) return;
    room.deepl.sendAudio(buffer);
  }

  handleSpeechEnd(eventCode) {
    const room = this.rooms.get(eventCode);
    if (!room || !room.deepl) return;
    room.deepl.markSpeechEnd();
  }

  async stopBroadcast(eventCode) {
    const room = this.rooms.get(eventCode);
    if (!room) return;
    if (room.deepl) room.deepl.stop();
    room.deepl = null;
    room.host = null;
    if (room.dbSession) await transcriptSvc.endSession(room.dbSession.id);
    logger.info(`Session ended: ${eventCode}`);
    this._broadcast(room, { type: 'status', live: false });
  }

  disconnectHost(eventCode, ws) {
    const room = this.rooms.get(eventCode);
    if (!room || room.host !== ws) return;
    room.host = null;
    if (room.deepl) {
      room.deepl.stop();
      room.deepl = null;
    }
    logger.info(`Host disconnected: ${eventCode}`);
    this._broadcast(room, { type: 'status', live: false });
  }

  /** Is a host actively broadcasting on this event right now? */
  isLive(eventCode) {
    const room = this.rooms.get(eventCode);
    return Boolean(room && room.host);
  }

  // ── Participant lifecycle ─────────────────────────────────────────────
  addParticipant(eventCode, ws) {
    const room = this._room(eventCode);
    room.participants.add(ws);
    logger.info(`Client connected: participant ${eventCode} (total ${room.participants.size})`);
    this._send(ws, {
      type: 'status',
      live: Boolean(room.host),
      deepl: room.deeplConnected,
      audio: config.deepl.enableTranslatedAudio,
      source: room.source,
      target: room.target,
    });
    this._broadcastDirection(room, ws);
    this._broadcastParticipantCount(room);
  }

  removeParticipant(eventCode, ws) {
    const room = this.rooms.get(eventCode);
    if (!room) return;
    room.participants.delete(ws);
    logger.info(`Client disconnected: participant ${eventCode} (total ${room.participants.size})`);
    this._broadcastParticipantCount(room);
  }

  // ── DeepL event handling ──────────────────────────────────────────────
  async _onDeeplEvent(room, evt) {
    switch (evt.kind) {
      case 'status':
        room.deeplConnected = evt.connected;
        this._sendHost(room, { type: 'status', deepl: evt.connected, live: Boolean(room.host) });
        this._broadcast(room, { type: 'service', deepl: evt.connected });
        break;

      case 'reconnecting':
        this._broadcast(room, { type: 'reconnecting' });
        this._sendHost(room, { type: 'reconnecting' });
        break;

      case 'transcript': {
        room.buf.source += evt.text;
        if (!room.buf.startedAt) room.buf.startedAt = new Date();
        this._broadcast(room, {
          type: 'tentative',
          original: normalize(room.buf.source),
          translated: normalize(room.buf.translation),
        });
        break;
      }

      case 'translation': {
        room.buf.translation += evt.text;
        if (!room.buf.startedAt) room.buf.startedAt = new Date();
        if (evt.final) {
          await this._finalizeSegment(room);
        } else {
          this._broadcast(room, {
            type: 'tentative',
            original: normalize(room.buf.source),
            translated: normalize(room.buf.translation),
          });
        }
        break;
      }

      case 'audio':
        if (config.deepl.enableTranslatedAudio) {
          this._broadcast(room, { type: 'audio', chunk: evt.base64 });
        }
        break;

      case 'error':
        // Errors are logged in the DeepL layer; nothing user-facing needed.
        break;

      default:
        break;
    }
  }

  async _finalizeSegment(room) {
    const source = normalize(room.buf.source);
    const translated = normalize(room.buf.translation);
    const startedAt = room.buf.startedAt;
    room.buf = { source: '', translation: '', startedAt: null };

    // Filter on the translated text (what the audience reads). Require some
    // source too, otherwise it is almost certainly a hallucination.
    const verdict = acceptFinalSegment(translated);
    if (!verdict.ok || !source) {
      logger.debug(`Segment rejected (${verdict.reason || 'no_source'})`);
      // Clear any lingering tentative text on the audience screens.
      this._broadcast(room, { type: 'tentative', original: '', translated: '' });
      return;
    }

    const endedAt = new Date();
    let id = null;
    if (room.dbSession) {
      id = await transcriptSvc.saveSegment(room.dbSession.id, {
        sourceText: source,
        translatedText: verdict.text,
        sourceLanguage: room.source,
        targetLanguage: room.target,
        startedAt,
        endedAt,
      });
    }

    this._broadcast(room, {
      type: 'final',
      id,
      original: source,
      translated: verdict.text,
      source: room.source,
      target: room.target,
      ts: endedAt.toISOString(),
    });
  }

  // ── Messaging helpers ─────────────────────────────────────────────────
  _send(ws, obj) {
    if (!ws || ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(obj));
    } catch (e) {
      /* ignore */
    }
  }

  _sendHost(room, obj) {
    this._send(room.host, obj);
  }

  _broadcast(room, obj) {
    const msg = JSON.stringify(obj);
    for (const ws of room.participants) {
      if (ws.readyState === 1) {
        try {
          ws.send(msg);
        } catch (e) {
          /* ignore */
        }
      }
    }
  }

  _broadcastDirection(room, only) {
    const dir = resolveDirection(room.source, room.target);
    const payload = {
      type: 'direction',
      source: room.source,
      target: room.target,
      sourceLabel: LANGUAGES[room.source]?.label || room.source,
      targetLabel: LANGUAGES[room.target]?.label || room.target,
      label: dir ? dir.label : `${room.source} → ${room.target}`,
      rtl: Boolean(LANGUAGES[room.target]?.rtl),
    };
    if (only) this._send(only, payload);
    else this._broadcast(room, payload);
  }

  _broadcastParticipantCount(room) {
    const count = room.participants.size;
    this._sendHost(room, { type: 'participants', count });
  }
}

module.exports = new SessionManager();
