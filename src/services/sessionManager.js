'use strict';

const deeplText = require('./deeplText');
const transcriptSvc = require('./transcript');
const { acceptFinalSegment, normalize } = require('./filters');
const { resolveDirection, LANGUAGES } = require('../config/languages');
const config = require('../config');
const logger = require('../utils/logger');

// How often (ms) an in-progress (interim) phrase may be re-translated for the
// live "tentative" preview. Keeps DeepL request volume sane during speech.
const INTERIM_TRANSLATE_MS = 700;

/**
 * In-memory orchestration of live events.
 *
 * Pipeline (browser STT → DeepL text API → participants):
 *   - The host page runs speech recognition and sends transcript messages
 *     ({ final, text }) over its WebSocket.
 *   - Interim (not final) text is shown to participants as TENTATIVE (faded)
 *     and translated at most once per INTERIM_TRANSLATE_MS.
 *   - On a FINAL phrase, the text is translated, run through hallucination
 *     filters, persisted (final only), and broadcast as FINAL.
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
        deeplConnected: false,
        dbSession: null,
        source: 'tr',
        target: 'en',
        interim: '',
        interimTranslated: '',
        startedAt: null,
        interimTimer: null,
        interimInFlight: false,
      };
      this.rooms.set(eventCode, room);
    }
    return room;
  }

  isLive(eventCode) {
    const room = this.rooms.get(eventCode);
    return Boolean(room && room.host);
  }

  // ── Host lifecycle ────────────────────────────────────────────────────
  async startBroadcast(eventCode, ws, { title, source, target }) {
    const dir = resolveDirection(source, target);
    if (!dir) throw new Error('Unsupported translation direction');

    const room = this._room(eventCode);
    room.host = ws;
    room.source = source;
    room.target = target;
    this._resetBuffer(room);

    room.dbSession = await transcriptSvc.createOrGetSession(eventCode, {
      title: title || 'Live Event',
      sourceLanguage: source,
      targetLanguage: target,
    });

    logger.info(`Session started: ${eventCode} (${source}->${target})`);
    this._sendHost(room, {
      type: 'config',
      source,
      target,
      audio: config.deepl.enableTranslatedAudio,
      deepl: room.deeplConnected,
    });
    this._broadcastDirection(room);
    this._broadcastParticipantCount(room);

    // Verify DeepL text API in the background and report status.
    deeplText.verify().then((ok) => {
      room.deeplConnected = ok;
      this._sendHost(room, { type: 'status', deepl: ok, live: true });
      this._broadcast(room, { type: 'service', deepl: ok });
    });
    return room;
  }

  async setDirection(eventCode, source, target) {
    const room = this.rooms.get(eventCode);
    if (!room) return;
    const dir = resolveDirection(source, target);
    if (!dir) return;
    room.source = source;
    room.target = target;
    this._resetBuffer(room);
    if (room.dbSession) await transcriptSvc.updateDirection(room.dbSession.id, source, target);
    this._broadcastDirection(room);
    logger.info(`Direction changed: ${eventCode} -> ${source}->${target}`);
  }

  /** Host sent a transcript chunk from browser speech recognition. */
  handleHostTranscript(eventCode, { final, text }) {
    const room = this.rooms.get(eventCode);
    if (!room) return;
    const clean = normalize(text);
    if (!clean && !final) return;

    if (final) {
      this._finalize(room, clean);
    } else {
      room.interim = clean;
      if (!room.startedAt) room.startedAt = new Date();
      this._broadcast(room, { type: 'tentative', original: clean, translated: room.interimTranslated });
      this._scheduleInterimTranslate(room);
    }
  }

  _scheduleInterimTranslate(room) {
    if (room.interimTimer || room.interimInFlight) return;
    room.interimTimer = setTimeout(async () => {
      room.interimTimer = null;
      const text = room.interim;
      if (!text) return;
      room.interimInFlight = true;
      try {
        const translated = await deeplText.translate(text, room.source, room.target);
        // Only apply if this phrase is still the one being spoken.
        if (room.interim === text) {
          room.interimTranslated = translated;
          this._broadcast(room, { type: 'tentative', original: text, translated });
        }
      } catch (e) {
        logger.debug('Interim translate failed (non-fatal)');
      } finally {
        room.interimInFlight = false;
      }
    }, INTERIM_TRANSLATE_MS);
  }

  async _finalize(room, sourceText) {
    if (room.interimTimer) { clearTimeout(room.interimTimer); room.interimTimer = null; }
    const startedAt = room.startedAt || new Date();
    const source = normalize(sourceText || room.interim);
    this._resetBuffer(room);

    if (!source) return;

    let translated = '';
    try {
      translated = await deeplText.translate(source, room.source, room.target);
    } catch (e) {
      logger.error('Final translate failed', e);
      // Clear the tentative line; nothing to finalize without a translation.
      this._broadcast(room, { type: 'tentative', original: '', translated: '' });
      return;
    }

    const verdict = acceptFinalSegment(translated);
    if (!verdict.ok) {
      logger.debug(`Segment rejected (${verdict.reason})`);
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
      rtl: Boolean(LANGUAGES[room.target]?.rtl),
      ts: endedAt.toISOString(),
    });
  }

  async stopBroadcast(eventCode) {
    const room = this.rooms.get(eventCode);
    if (!room) return;
    if (room.interimTimer) { clearTimeout(room.interimTimer); room.interimTimer = null; }
    room.host = null;
    if (room.dbSession) await transcriptSvc.endSession(room.dbSession.id);
    logger.info(`Session ended: ${eventCode}`);
    this._broadcast(room, { type: 'status', live: false });
  }

  disconnectHost(eventCode, ws) {
    const room = this.rooms.get(eventCode);
    if (!room || room.host !== ws) return;
    if (room.interimTimer) { clearTimeout(room.interimTimer); room.interimTimer = null; }
    room.host = null;
    logger.info(`Host disconnected: ${eventCode}`);
    this._broadcast(room, { type: 'status', live: false });
  }

  _resetBuffer(room) {
    room.interim = '';
    room.interimTranslated = '';
    room.startedAt = null;
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
    this._sendHost(room, { type: 'participants', count: room.participants.size });
  }
}

module.exports = new SessionManager();
