'use strict';

const sessionManager = require('../services/sessionManager');
const { resolveDirection } = require('../config/languages');
const logger = require('../utils/logger');

/**
 * Host socket. The browser runs speech recognition and sends JSON frames:
 *   {type:'start'|'stop'|'direction'|'ping', ...}
 *   {type:'transcript', final:boolean, text:string}
 */
function registerHost(ws, eventCode, claims) {
  logger.info(`Client connected: host ${eventCode} (${claims.sub})`);
  ws.on('message', async (data) => {
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
        case 'transcript':
          sessionManager.handleHostTranscript(eventCode, {
            final: Boolean(msg.final),
            text: typeof msg.text === 'string' ? msg.text : '',
          });
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
