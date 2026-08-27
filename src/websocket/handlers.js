'use strict';

const sessionManager = require('../services/sessionManager');
const { resolveDirection } = require('../config/languages');
const logger = require('../utils/logger');

/**
 * Host socket. The browser sends:
 *   - JSON control frames: {type:'start'|'stop'|'direction'|'speech_end'|'ping', ...}
 *   - Binary frames: raw PCM16 (16kHz mono) audio, only during detected speech.
 */
function registerHost(ws, eventCode, claims) {
  logger.info(`Client connected: host ${eventCode} (${claims.sub})`);
  ws.on('message', async (data, isBinary) => {
    if (isBinary) {
      // Ignore tiny keepalive frames.
      if (data.length < 4) return;
      sessionManager.handleHostAudio(eventCode, Buffer.from(data));
      return;
    }
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      return;
    }
    try {
      switch (msg.type) {
        case 'start': {
          const dir =
            resolveDirection(msg.source, msg.target) ||
            resolveDirection('tr', 'en');
          await sessionManager.startBroadcast(eventCode, ws, {
            title: msg.title,
            source: dir.source,
            target: dir.target,
          });
          break;
        }
        case 'direction':
          await sessionManager.setDirection(eventCode, msg.source, msg.target);
          break;
        case 'speech_end':
          sessionManager.handleSpeechEnd(eventCode);
          break;
        case 'stop':
          await sessionManager.stopBroadcast(eventCode);
          break;
        case 'ping':
        default:
          break;
      }
    } catch (e) {
      logger.error('Host control error', e);
    }
  });

  ws.on('close', () => {
    sessionManager.disconnectHost(eventCode, ws);
  });
  ws.on('error', (e) => {
    logger.error('Host WS error', e);
  });
}

/** Participant socket. Receive-only; inbound text (PING) is ignored. */
function registerParticipant(ws, eventCode) {
  sessionManager.addParticipant(eventCode, ws);
  ws.on('message', () => {
    /* audience is receive-only */
  });
  ws.on('close', () => {
    sessionManager.removeParticipant(eventCode, ws);
  });
  ws.on('error', () => {
    sessionManager.removeParticipant(eventCode, ws);
  });
}

module.exports = { registerHost, registerParticipant };
