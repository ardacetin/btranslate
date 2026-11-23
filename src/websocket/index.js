'use strict';

const { WebSocketServer } = require('ws');
const { URL } = require('url');
const { authenticateToken, AuthError } = require('../middleware/auth');
const sessionManager = require('../services/sessionManager');
const { registerHost, registerParticipant } = require('./handlers');
const logger = require('../utils/logger');

const EVENT_CODE_RE = /^[A-Z0-9]{1,32}$/;

// Largest frame we accept from anyone. Host audio frames are ~8 KB and
// transcript JSON is tiny; without a cap `ws` buffers frames up to 100 MiB.
const MAX_PAYLOAD = 64 * 1024;
// Hosts must authenticate within this time after connecting.
const HOST_AUTH_TIMEOUT_MS = 5000;
// Generous because a whole campus can sit behind one NAT address.
const MAX_CONNECTIONS_PER_IP = Number(process.env.WS_MAX_CONNECTIONS_PER_IP) || 300;
// Distinct event rooms that may exist at once (codes are normally just LIVE).
const MAX_ROOMS = Number(process.env.WS_MAX_ROOMS) || 50;

// Application close codes understood by the frontend.
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_TRY_AGAIN = 1013;

/**
 * Real client address. Behind CloudPanel/Nginx the socket peer is the proxy
 * (loopback), so take the address Nginx appended last to X-Forwarded-For —
 * earlier entries are client-supplied and can't be trusted.
 */
function clientIp(req) {
  const peer = req.socket.remoteAddress || '';
  const isLoopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
  const xff = req.headers['x-forwarded-for'];
  if (isLoopback && typeof xff === 'string' && xff.trim()) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return peer;
}

function reject(socket, status, text) {
  try {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  } catch (e) { /* ignore */ }
  socket.destroy();
}

/**
 * Host sockets authenticate with their first message — {type:'auth', token} —
 * instead of a ?token= query parameter, so the JWT never ends up in Nginx
 * access logs. (A legacy ?token= is still accepted from old cached pages.)
 */
function authenticateHost(ws, code, legacyToken) {
  const finish = (token) => {
    authenticateToken(token)
      .then((claims) => {
        if (ws.readyState !== 1) return;
        registerHost(ws, code, claims);
        ws.send(JSON.stringify({ type: 'auth_ok', username: claims.sub }));
      })
      .catch((e) => {
        if (e instanceof AuthError) {
          logger.warn(`Rejected host WS: ${e.message}`);
          ws.close(CLOSE_UNAUTHORIZED, 'unauthorized');
        } else {
          logger.error('Host WS auth check failed', e);
          ws.close(CLOSE_TRY_AGAIN, 'try again later');
        }
      });
  };

  if (legacyToken) {
    logger.warn('Host WS used deprecated ?token= query parameter (reload the host page)');
    finish(legacyToken);
    return;
  }

  const timer = setTimeout(() => ws.close(CLOSE_UNAUTHORIZED, 'auth timeout'), HOST_AUTH_TIMEOUT_MS);
  ws.once('message', (data, isBinary) => {
    clearTimeout(timer);
    let msg = null;
    if (!isBinary) {
      try { msg = JSON.parse(data.toString()); } catch (e) { /* fall through */ }
    }
    if (!msg || msg.type !== 'auth' || typeof msg.token !== 'string') {
      ws.close(CLOSE_UNAUTHORIZED, 'auth required');
      return;
    }
    finish(msg.token);
  });
  ws.once('close', () => clearTimeout(timer));
}

/**
 * Attach a single WebSocket server to the existing HTTP server, routing by
 * path during the upgrade handshake:
 *   /ws/host/:code          — authenticated broadcaster (first message: auth)
 *   /ws/participant/:code   — public audience (receive-only)
 *
 * Using one server behind CloudPanel/Nginx keeps the reverse-proxy config
 * simple (single WS upgrade location).
 */
function attachWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  const perIp = new Map();

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

  function track(ws, ip) {
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    // e.g. an oversized frame: ws emits 'error' then closes. Without a listener
    // an 'error' event would be thrown and crash the process.
    ws.on('error', () => {});
    ws.once('close', () => {
      const n = (perIp.get(ip) || 1) - 1;
      if (n <= 0) perIp.delete(ip); else perIp.set(ip, n);
    });
  }

  server.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
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
    if (!EVENT_CODE_RE.test(code) || (role !== 'host' && role !== 'participant')) {
      socket.destroy();
      return;
    }

    const ip = clientIp(req);
    if ((perIp.get(ip) || 0) >= MAX_CONNECTIONS_PER_IP) {
      logger.warn(`Rejected WS: too many connections from one address (${MAX_CONNECTIONS_PER_IP})`);
      reject(socket, 429, 'Too Many Requests');
      return;
    }

    if (role === 'host') {
      const legacyToken = url.searchParams.get('token');
      wss.handleUpgrade(req, socket, head, (ws) => {
        track(ws, ip);
        authenticateHost(ws, code, legacyToken);
      });
      return;
    }

    if (!sessionManager.canJoin(code, MAX_ROOMS)) {
      logger.warn('Rejected participant WS: room limit reached');
      reject(socket, 503, 'Service Unavailable');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      track(ws, ip);
      registerParticipant(ws, code);
    });
  });

  logger.info('WebSocket server attached');
  return wss;
}

module.exports = { attachWebSocket, MAX_PAYLOAD };
