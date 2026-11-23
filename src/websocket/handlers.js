'use strict';

const sessionManager = require('../services/sessionManager');
const { resolveDirection } = require('../config/languages');
const logger = require('../utils/logger');

const MAX_TRANSCRIPT_CHARS = 2000;
const MAX_TITLE_CHARS = 255;

/**
 * Host socket (already authenticated). The browser runs speech recognition
 * and sends JSON frames:
 *   {type:'start'|'stop'|'direction'|'ping', ...}
 *   {type:'transcript', final:boolean, text:string}
 * or binary frames of raw PCM16 audio (OpenAI engine). Every control action is
 * checked against room ownership inside the session manager, so a socket that
 * has been superseded by a newer host connection can no longer steer the room.
 */
function registerHost(ws, eventCode, claims) {
  logger.info(`Client connected: host ${eventCode} (${claims.sub})`);
  ws.on('message', async (data, isBinary) => {
    // Binary frames are raw PCM16 audio (OpenAI realtime engine).
    if (isBinary) {
      if (data.length >= 4) sessionManager.handleHostAudio(eventCode, ws, Buffer.from(data));
      return;
    }
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    try {
      switch (msg.type) {
        case 'start': {
          const dir =
            resolveDirection(msg.source, msg.target) ||
            resolveDirection('tr', 'en');
          await sessionManager.startBroadcast(eventCode, ws, {
            title: typeof msg.title === 'string' ? msg.title.slice(0, MAX_TITLE_CHARS) : '',
            source: dir.source,
            target: dir.target,
          });
          break;
        }
        case 'direction':
          await sessionManager.setDirection(eventCode, ws, msg.source, msg.target);
          break;
        case 'transcript':
          sessionManager.handleHostTranscript(eventCode, ws, {
            final: Boolean(msg.final),
            text: typeof msg.text === 'string' ? msg.text.slice(0, MAX_TRANSCRIPT_CHARS) : '',
          });
          break;
        case 'stop':
          await sessionManager.stopBroadcast(eventCode, ws);
          break;
        case 'ping':
        default:
          break;
      }
    } catch (e) {
      logger.error('Host control error', e);
      if (msg.type === 'start' && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'error', code: 'start_failed' }));
      }
    }
  });

  ws.on('close', () => {
    sessionManager.disconnectHost(eventCode, ws);
  });
  ws.on('error', (e) => {
    logger.error('Host WS error', e);
  });
}

/**
 * Participant socket. Receive-only, apart from a keep-alive and the audio
 * opt-in (server audio is only streamed to listeners who turned it on).
 * Anything else is a protocol violation and closes the socket.
 */
const PARTICIPANT_MESSAGES = new Set(['PING', 'AUDIO_ON', 'AUDIO_OFF']);

function registerParticipant(ws, eventCode) {
  ws.wantsAudio = false;
  sessionManager.addParticipant(eventCode, ws);
  ws.on('message', (data, isBinary) => {
    const text = isBinary || data.length > 16 ? '' : data.toString();
    if (!PARTICIPANT_MESSAGES.has(text)) {
      ws.close(1008, 'receive-only');
      return;
    }
    if (text === 'AUDIO_ON') ws.wantsAudio = true;
    else if (text === 'AUDIO_OFF') ws.wantsAudio = false;
  });
  ws.on('close', () => {
    sessionManager.removeParticipant(eventCode, ws);
  });
  ws.on('error', () => {
    sessionManager.removeParticipant(eventCode, ws);
  });
}

module.exports = { registerHost, registerParticipant };
