'use strict';

/**
 * Process lifecycle hook shared by server.js (signals, fatal errors) and the
 * admin "restart service" endpoint, so every exit goes through the same
 * graceful shutdown: close WebSocket clients, drain HTTP, close the DB pool.
 *
 * server.js registers the real handler with setShutdownHandler(); until then
 * (or in scripts that never register one) requestShutdown() just exits.
 */
let handler = null;

function setShutdownHandler(fn) {
  handler = typeof fn === 'function' ? fn : null;
}

/**
 * @param {string} reason   human-readable cause, used in the log line
 * @param {number} exitCode 0 = intentional (restart/stop), non-zero = failure
 */
function requestShutdown(reason, exitCode = 0) {
  if (!handler) {
    process.exit(exitCode);
    return;
  }
  handler(reason, exitCode);
}

module.exports = { setShutdownHandler, requestShutdown };
