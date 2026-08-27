'use strict';

const { WebSocketServer } = require('ws');
const { URL } = require('url');
const { verifyToken } = require('../middleware/auth');
const { isValidLanguage } = require('../config/languages');
const { registerHost, registerParticipant } = require('./handlers');
const logger = require('../utils/logger');

const EVENT_CODE_RE = /^[A-Z0-9]{1,32}$/;

/**
 * Attach a single WebSocket server to the existing HTTP server, routing by
 * path during the upgrade handshake:
 *   /ws/host/:code?token=<jwt>   — authenticated broadcaster
 *   /ws/participant/:code        — public audience (receive-only)
 *
 * Using one server behind CloudPanel/Nginx keeps the reverse-proxy config
 * simple (single WS upgrade location).
 */
function attachWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  // Heartbeat: drop dead sockets so connections don't accumulate over long
  // events (30-60+ min), preventing leaks.
  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch (e) {
        /* ignore */
      }
    }
  }, 30000);
  wss.on('close', () => clearInterval(interval));

  server.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host}`);
    } catch (e) {
      socket.destroy();
      return;
    }

    const parts = url.pathname.split('/').filter(Boolean); // ['ws','host','LIVE']
    if (parts[0] !== 'ws') {
      socket.destroy();
      return;
    }

    const role = parts[1];
    const code = String(parts[2] || '').toUpperCase();
    if (!EVENT_CODE_RE.test(code)) {
      socket.destroy();
      return;
    }

    if (role === 'host') {
      const token = url.searchParams.get('token');
      let claims;
      try {
        claims = verifyToken(token);
      } catch (e) {
        logger.warn('Rejected host WS: invalid token');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
        registerHost(ws, code, claims);
      });
      return;
    }

    if (role === 'participant') {
      // Optional target-language hint in path (legacy): /ws/participant/:code/:lang
      const langHint = parts[3];
      if (langHint && !isValidLanguage(langHint)) {
        // ignore invalid hint; audience follows host direction anyway
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
        registerParticipant(ws, code);
      });
      return;
    }

    socket.destroy();
  });

  logger.info('WebSocket server attached');
  return wss;
}

module.exports = { attachWebSocket };
