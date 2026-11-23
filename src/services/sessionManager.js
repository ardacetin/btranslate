'use strict';

const deeplText = require('./deeplText');
const transcriptSvc = require('./transcript');
const settings = require('./settings');
const { OpenAIRealtimeSession } = require('./openaiRealtime');
const { acceptFinalSegment, normalize } = require('./filters');
const { resolveDirection, LANGUAGES } = require('../config/languages');
const config = require('../config');
const logger = require('../utils/logger');

// How often (ms) an in-progress (interim) phrase may be re-translated for the
// live "tentative" preview. Lower = snappier live translation, more requests.
const INTERIM_TRANSLATE_MS = 350;
// OpenAI engine: finalize a segment after this much silence in the streamed
// translation deltas (the translate endpoint streams continuous deltas).
const OPENAI_FINALIZE_MS = 1000;
// …or sooner once the translation ends a sentence.
const OPENAI_PUNCT_FINALIZE_MS = 350;
// …and never let one segment grow past these limits (continuous speakers).
const OPENAI_MAX_SEGMENT_MS = 15000;
const OPENAI_MAX_SEGMENT_CHARS = 350;
// Coalesce tentative broadcasts of the OpenAI stream (it sends many tiny deltas).
const OPENAI_TENTATIVE_THROTTLE_MS = 150;

// Per-socket send buffer limits. Droppable frames (tentative text, audio) are
// skipped for a client that is this far behind; past the hard limit the client
// is cut off (it reconnects and catches up instead of growing server memory).
const SOFT_BUFFER_LIMIT = 256 * 1024;
const HARD_BUFFER_LIMIT = 8 * 1024 * 1024;

const MAX_TITLE_LENGTH = 255;
const SENTENCE_END = /[.!?…。？！]["'’”)\]]?\s*$/;

/**
 * In-memory orchestration of live events.
 *
 * Pipeline (browser STT → DeepL text API → participants):
 *   - The host page runs speech recognition and sends transcript messages
 *     ({ final, text }) over its WebSocket.
 *   - Every spoken phrase gets a sequence number (`seg`). Interim text is
 *     shown to participants as TENTATIVE (faded) and translated at most once
 *     per INTERIM_TRANSLATE_MS; tentative/final/drop messages carry `seg` so a
 *     client always updates the right line.
 *   - FINAL phrases are translated in parallel but emitted strictly in spoken
 *     order through a per-room promise chain (a short phrase can never overtake
 *     a long one), then filtered, persisted (final only) and broadcast.
 *
 * Only the socket that currently owns a room (`room.host`) may control it; a
 * newer host connection takes over and the previous one is told so.
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
        engine: 'deepl',        // 'deepl' | 'openai'
        translatorConnected: false,
        serverAudio: false,     // true when OpenAI streams translated audio
        dbSession: null,
        source: 'tr',
        target: 'en',
        seq: 0,                 // last phrase sequence number handed out
        emitChain: Promise.resolve(),
        pendingFinals: 0,
        // DeepL (browser STT) path
        currentSeg: null,
        interim: '',
        interimTranslated: '',
        startedAt: null,
        interimTimer: null,
        interimInFlight: false,
        // OpenAI realtime path
        openai: null,
        oaSeg: null,
        oaSource: '',
        oaTranslation: '',
        oaStartedAt: null,
        oaTimer: null,
        oaTentativeTimer: null,
      };
      this.rooms.set(eventCode, room);
    }
    return room;
  }

  /** Whether a participant may open (or join) this room. */
  canJoin(eventCode, maxRooms) {
    return this.rooms.has(eventCode) || this.rooms.size < maxRooms;
  }

  /** Forget a room once nobody uses it, so random event codes can't pile up. */
  _maybeDispose(room) {
    if (room.host || room.participants.size > 0 || room.pendingFinals > 0) return;
    this._clearTimers(room);
    this._stopOpenai(room);
    if (this.rooms.get(room.eventCode) === room) this.rooms.delete(room.eventCode);
  }

  _clearTimers(room) {
    if (room.interimTimer) { clearTimeout(room.interimTimer); room.interimTimer = null; }
    if (room.oaTimer) { clearTimeout(room.oaTimer); room.oaTimer = null; }
    if (room.oaTentativeTimer) { clearTimeout(room.oaTentativeTimer); room.oaTentativeTimer = null; }
  }

  isLive(eventCode) {
    const room = this.rooms.get(eventCode);
    return Boolean(room && room.host);
  }

  /** Tell every connected participant of this event to reload their page. */
  refreshClients(eventCode) {
    const room = this.rooms.get(eventCode);
    if (!room) return 0;
    this._broadcast(room, { type: 'reload' });
    logger.info(`Refresh sent to participants: ${eventCode} (${room.participants.size})`);
    return room.participants.size;
  }

  // ── Host lifecycle ────────────────────────────────────────────────────
  async startBroadcast(eventCode, ws, { title, source, target }) {
    const dir = resolveDirection(source, target);
    if (!dir) throw new Error('Unsupported translation direction');

    const room = this._room(eventCode);
    if (room.host && room.host !== ws) {
      // A newer host connection takes over (e.g. the host reloaded, or a
      // second operator started). Tell the old one so it stops reconnecting.
      const old = room.host;
      logger.warn(`Host superseded on ${eventCode}`);
      this._send(old, { type: 'superseded' });
      try { old.close(4409, 'superseded'); } catch (e) { /* ignore */ }
    }
    room.host = ws;
    room.source = source;
    room.target = target;
    this._resetBuffer(room);

    // An empty title (e.g. host page resumed after a reload) keeps the
    // event's current title instead of renaming it to the default.
    let cleanTitle = normalize(String(title || '')).slice(0, MAX_TITLE_LENGTH);
    if (!cleanTitle) {
      const existing = await transcriptSvc.getSessionByCode(eventCode);
      cleanTitle = (existing && existing.title) || 'Live Event';
    }
    if (room.host !== ws) return null;

    room.dbSession = await transcriptSvc.createOrGetSession(eventCode, {
      title: cleanTitle,
      sourceLanguage: source,
      targetLanguage: target,
    });
    if (room.host !== ws) return null;

    // Decide the voice engine from admin settings (falls back to deepl).
    const cfg = await settings.getAll();
    if (room.host !== ws) return null; // host left / was replaced meanwhile
    const wantOpenai = cfg.voice_engine === 'openai' && Boolean(config.openai.apiKey);
    room.engine = wantOpenai ? 'openai' : 'deepl';
    room.serverAudio = room.engine === 'openai';

    logger.info(`Session started: ${eventCode} (${source}->${target}) engine=${room.engine}`);
    this._sendHost(room, {
      type: 'config',
      source,
      target,
      title: cleanTitle,
      engine: room.engine,
      serverAudio: room.serverAudio,
      audio: config.deepl.enableTranslatedAudio,
    });
    this._broadcast(room, { type: 'status', live: true, title: cleanTitle });
    this._broadcastDirection(room);
    this._broadcastParticipantCount(room);

    if (room.engine === 'openai') {
      this._ensureOpenai(room);
    } else {
      this._stopOpenai(room);
      deeplText.verify().then((ok) => {
        if (room.host !== ws) return;
        room.translatorConnected = ok;
        this._sendHost(room, { type: 'status', engine: 'deepl', connected: ok, live: true });
        this._broadcast(room, { type: 'service', engine: 'deepl', connected: ok });
      });
    }
    return room;
  }

  _ensureOpenai(room) {
    this._stopOpenai(room);
    const session = new OpenAIRealtimeSession({
      source: room.source,
      target: room.target,
      // Ignore late events from a session that has since been replaced.
      onEvent: (evt) => { if (room.openai === session) this._onOpenaiEvent(room, evt); },
    });
    room.openai = session;
    session.start();
  }

  async setDirection(eventCode, ws, source, target) {
    const room = this.rooms.get(eventCode);
    if (!room || room.host !== ws) return;
    const dir = resolveDirection(source, target);
    if (!dir) return;
    if (room.engine === 'openai') this._finalizeOpenai(room); // close the segment in the old direction
    room.source = source;
    room.target = target;
    this._resetBuffer(room);
    if (room.engine === 'openai') this._ensureOpenai(room); // reconnect with new target
    this._broadcastDirection(room);
    logger.info(`Direction changed: ${eventCode} -> ${source}->${target}`);
    if (room.dbSession) await transcriptSvc.updateDirection(room.dbSession.id, source, target);
  }

  /** Host sent a transcript chunk from browser speech recognition. */
  handleHostTranscript(eventCode, ws, { final, text }) {
    const room = this.rooms.get(eventCode);
    if (!room || room.host !== ws) return;
    const clean = normalize(text);
    if (!clean && !final) return;

    if (final) {
      this._finalize(room, clean);
    } else {
      if (room.currentSeg === null) room.currentSeg = ++room.seq;
      room.interim = clean;
      if (!room.startedAt) room.startedAt = new Date();
      this._broadcast(room, {
        type: 'tentative', seg: room.currentSeg, original: clean, translated: room.interimTranslated,
      }, { droppable: true });
      this._scheduleInterimTranslate(room);
    }
  }

  _scheduleInterimTranslate(room) {
    if (room.interimTimer || room.interimInFlight) return;
    room.interimTimer = setTimeout(async () => {
      room.interimTimer = null;
      const text = room.interim;
      const seg = room.currentSeg;
      if (!text || seg === null) return;
      room.interimInFlight = true;
      try {
        const translated = await deeplText.translate(text, room.source, room.target, { timeoutMs: 2500 });
        // Apply to the phrase it belongs to, even if a few more words have
        // been recognized meanwhile — a slightly stale preview beats none.
        if (room.currentSeg === seg && room.interim) {
          room.interimTranslated = translated;
          this._broadcast(room, {
            type: 'tentative', seg, original: room.interim, translated,
          }, { droppable: true });
        }
      } catch (e) {
        logger.debug('Interim translate failed (non-fatal)');
      } finally {
        room.interimInFlight = false;
        // The phrase kept growing while we waited: refresh the preview.
        if (room.currentSeg === seg && room.interim && room.interim !== text) {
          this._scheduleInterimTranslate(room);
        }
      }
    }, INTERIM_TRANSLATE_MS);
  }

  _finalize(room, sourceText) {
    if (room.interimTimer) { clearTimeout(room.interimTimer); room.interimTimer = null; }
    const startedAt = room.startedAt || new Date();
    const source = normalize(sourceText || room.interim);
    const seg = room.currentSeg !== null ? room.currentSeg : ++room.seq;
    const { source: from, target: to } = room;
    this._resetBuffer(room);
    if (!source) {
      this._broadcast(room, { type: 'drop', seg });
      return;
    }
    // Start translating right away (in parallel with earlier phrases)…
    const translation = deeplText
      .translate(source, from, to, { timeoutMs: 4000, retries: 2 })
      .then((text) => ({ ok: true, text }))
      .catch((e) => {
        logger.error('Final translate failed after retries — sending original only', e);
        return { ok: false, text: '' };
      });
    // …but emit strictly in spoken order.
    this._enqueueFinal(room, () => translation.then((tr) => this._emitFinal(room, {
      seg, source, translation: tr, from, to, startedAt,
    })));
  }

  _enqueueFinal(room, task) {
    room.pendingFinals += 1;
    room.emitChain = room.emitChain
      .then(task)
      .catch((e) => logger.error('Final segment failed', e))
      .finally(() => {
        room.pendingFinals -= 1;
        this._maybeDispose(room);
      });
  }

  async _emitFinal(room, { seg, source, translation, from, to, startedAt }) {
    // Hallucination/junk filter. If translation failed, still deliver the
    // original text (filtered the same way) rather than losing the sentence.
    const verdict = acceptFinalSegment(translation.ok ? translation.text : source);
    if (!verdict.ok) {
      logger.debug(`Segment rejected (${verdict.reason})`);
      this._broadcast(room, { type: 'drop', seg });
      return;
    }
    const translated = translation.ok ? verdict.text : '';
    const endedAt = new Date();
    let id = null;
    if (room.dbSession) {
      id = await transcriptSvc.saveSegment(room.dbSession.id, {
        sourceText: source,
        translatedText: translated,
        sourceLanguage: from,
        targetLanguage: to,
        startedAt,
        endedAt,
      });
    }
    this._broadcast(room, {
      type: 'final',
      seg,
      id,
      original: source,
      translated,
      untranslated: !translation.ok,
      source: from,
      target: to,
      rtl: Boolean(LANGUAGES[to]?.rtl),
      ts: endedAt.toISOString(),
    });
  }

  // ── OpenAI realtime path ──────────────────────────────────────────────
  /** Forward a PCM16 audio chunk from the host to the OpenAI session. */
  handleHostAudio(eventCode, ws, buffer) {
    const room = this.rooms.get(eventCode);
    if (!room || room.host !== ws || room.engine !== 'openai' || !room.openai) return;
    room.openai.sendAudio(buffer);
  }

  _onOpenaiEvent(room, evt) {
    switch (evt.kind) {
      case 'status':
        room.translatorConnected = evt.connected;
        this._sendHost(room, { type: 'status', engine: 'openai', connected: evt.connected, live: Boolean(room.host) });
        this._broadcast(room, { type: 'service', engine: 'openai', connected: evt.connected });
        break;
      case 'reconnecting':
        this._sendHost(room, { type: 'reconnecting' });
        this._broadcast(room, { type: 'reconnecting' });
        break;
      case 'transcript':
      case 'translation': {
        if (room.oaSeg === null) {
          room.oaSeg = ++room.seq;
          room.oaStartedAt = new Date();
        }
        if (evt.kind === 'transcript') room.oaSource += evt.text;
        else room.oaTranslation += evt.text;
        this._scheduleOaTentative(room);
        this._armOaFinalize(room);
        break;
      }
      case 'audio': {
        let buf;
        try { buf = Buffer.from(evt.base64, 'base64'); } catch (e) { return; }
        if (buf.length < 2) return;
        // Binary frame (no base64/JSON overhead), only to listeners who
        // turned audio on, and dropped for clients that are falling behind.
        for (const ws of room.participants) {
          if (ws.wantsAudio) this._sendRaw(ws, buf, true);
        }
        break;
      }
      default:
        break;
    }
  }

  _scheduleOaTentative(room) {
    if (room.oaTentativeTimer) return;
    room.oaTentativeTimer = setTimeout(() => {
      room.oaTentativeTimer = null;
      if (room.oaSeg === null) return;
      this._broadcast(room, {
        type: 'tentative',
        seg: room.oaSeg,
        original: normalize(room.oaSource),
        translated: normalize(room.oaTranslation),
      }, { droppable: true });
    }, OPENAI_TENTATIVE_THROTTLE_MS);
  }

  _armOaFinalize(room) {
    if (room.oaTimer) clearTimeout(room.oaTimer);
    room.oaTimer = null;
    const age = Date.now() - (room.oaStartedAt ? room.oaStartedAt.getTime() : Date.now());
    if (age >= OPENAI_MAX_SEGMENT_MS || room.oaTranslation.length >= OPENAI_MAX_SEGMENT_CHARS) {
      this._finalizeOpenai(room);
      return;
    }
    const delay = SENTENCE_END.test(room.oaTranslation) ? OPENAI_PUNCT_FINALIZE_MS : OPENAI_FINALIZE_MS;
    room.oaTimer = setTimeout(() => this._finalizeOpenai(room), delay);
  }

  _finalizeOpenai(room) {
    if (room.oaTimer) { clearTimeout(room.oaTimer); room.oaTimer = null; }
    if (room.oaTentativeTimer) { clearTimeout(room.oaTentativeTimer); room.oaTentativeTimer = null; }
    const seg = room.oaSeg;
    const source = normalize(room.oaSource);
    const translated = normalize(room.oaTranslation);
    const startedAt = room.oaStartedAt || new Date();
    const { source: from, target: to } = room;
    room.oaSeg = null; room.oaSource = ''; room.oaTranslation = ''; room.oaStartedAt = null;
    if (seg === null) return;
    if (!translated) {
      this._broadcast(room, { type: 'drop', seg });
      return;
    }
    this._enqueueFinal(room, () => this._emitFinal(room, {
      seg, source, translation: { ok: true, text: translated }, from, to, startedAt,
    }));
  }

  _stopOpenai(room) {
    if (room.oaTimer) { clearTimeout(room.oaTimer); room.oaTimer = null; }
    if (room.oaTentativeTimer) { clearTimeout(room.oaTentativeTimer); room.oaTentativeTimer = null; }
    if (room.openai) { room.openai.stop(); room.openai = null; }
    room.oaSeg = null; room.oaSource = ''; room.oaTranslation = ''; room.oaStartedAt = null;
  }

  async stopBroadcast(eventCode, ws) {
    const room = this.rooms.get(eventCode);
    if (!room || room.host !== ws) return;
    // Deliver what was already spoken before going off-air.
    if (room.interim) this._finalize(room, room.interim);
    if (room.engine === 'openai') this._finalizeOpenai(room);
    if (room.interimTimer) { clearTimeout(room.interimTimer); room.interimTimer = null; }
    this._stopOpenai(room);
    room.host = null;
    logger.info(`Session ended: ${eventCode}`);
    this._broadcast(room, { type: 'status', live: false });
    const dbSession = room.dbSession;
    this._maybeDispose(room);
    if (dbSession) await transcriptSvc.endSession(dbSession.id);
  }

  disconnectHost(eventCode, ws) {
    const room = this.rooms.get(eventCode);
    if (!room || room.host !== ws) return;
    if (room.interimTimer) { clearTimeout(room.interimTimer); room.interimTimer = null; }
    // The unfinished phrase will never be finalized: remove its faded line.
    for (const seg of [room.currentSeg, room.oaSeg]) {
      if (seg !== null) this._broadcast(room, { type: 'drop', seg });
    }
    this._stopOpenai(room);
    room.host = null;
    this._resetBuffer(room);
    logger.info(`Host disconnected: ${eventCode}`);
    this._broadcast(room, { type: 'status', live: false });
    this._maybeDispose(room);
  }

  _resetBuffer(room) {
    room.currentSeg = null;
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
      engine: room.engine,
      connected: room.translatorConnected,
      serverAudio: room.serverAudio,
      audio: config.deepl.enableTranslatedAudio,
      source: room.source,
      target: room.target,
      title: room.dbSession ? room.dbSession.title : undefined,
    });
    this._broadcastDirection(room, ws);
    this._broadcastParticipantCount(room);
  }

  removeParticipant(eventCode, ws) {
    const room = this.rooms.get(eventCode);
    if (!room || !room.participants.delete(ws)) return;
    logger.info(`Client disconnected: participant ${eventCode} (total ${room.participants.size})`);
    this._broadcastParticipantCount(room);
    this._maybeDispose(room);
  }

  /** Every socket of every room (used for a graceful shutdown). */
  allSockets() {
    const out = [];
    for (const room of this.rooms.values()) {
      if (room.host) out.push(room.host);
      out.push(...room.participants);
    }
    return out;
  }

  // ── Messaging helpers ─────────────────────────────────────────────────
  /**
   * Send with backpressure: droppable frames are skipped for a slow client,
   * and a client that is hopelessly behind is disconnected.
   */
  _sendRaw(ws, data, droppable) {
    if (!ws || ws.readyState !== 1) return;
    if (ws.bufferedAmount > HARD_BUFFER_LIMIT) {
      logger.warn('Dropping a client that is too far behind (send buffer full)');
      try { ws.terminate(); } catch (e) { /* ignore */ }
      return;
    }
    if (droppable && ws.bufferedAmount > SOFT_BUFFER_LIMIT) return;
    try {
      ws.send(data);
    } catch (e) {
      /* ignore */
    }
  }

  _send(ws, obj) {
    this._sendRaw(ws, JSON.stringify(obj), false);
  }

  _sendHost(room, obj) {
    this._send(room.host, obj);
  }

  _broadcast(room, obj, { droppable = false } = {}) {
    const msg = JSON.stringify(obj);
    for (const ws of room.participants) this._sendRaw(ws, msg, droppable);
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
      serverAudio: room.serverAudio,
    };
    if (only) this._send(only, payload);
    else this._broadcast(room, payload);
  }

  _broadcastParticipantCount(room) {
    this._sendHost(room, { type: 'participants', count: room.participants.size });
  }
}

module.exports = new SessionManager();
