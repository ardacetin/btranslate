'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');
const users = require('../services/users');
const logger = require('../utils/logger');

function signToken(user) {
  return jwt.sign(
    { sub: user.username, role: user.role, uid: user.id, tv: Number(user.token_version) || 0 },
    config.auth.jwtSecret,
    { expiresIn: config.auth.jwtExpiresIn, algorithm: 'HS256' }
  );
}

function verifyToken(token) {
  // Pin the algorithm: never let the token header choose how it is verified.
  return jwt.verify(token, config.auth.jwtSecret, { algorithms: ['HS256'] });
}

function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

class AuthError extends Error {}

/**
 * Verify a JWT *and* check it against the current account state, so that a
 * deleted / deactivated user, or a token issued before a password change, is
 * rejected immediately instead of staying valid until it expires. The role is
 * taken from the database, not from the token, so role changes apply at once.
 *
 * Resolves to { uid, sub, role, display_name }. Throws AuthError when the
 * token is not acceptable; any other error means the DB is unavailable.
 */
async function authenticateToken(token) {
  let claims;
  try {
    claims = verifyToken(token);
  } catch (e) {
    throw new AuthError('Invalid or expired token');
  }
  const user = Number.isInteger(claims.uid) ? await users.findById(claims.uid) : null;
  if (!user) throw new AuthError('Account no longer exists');
  if (!user.is_active) throw new AuthError('Account is disabled');
  if ((Number(claims.tv) || 0) !== (Number(user.token_version) || 0)) {
    throw new AuthError('Session expired, please sign in again');
  }
  return { uid: user.id, sub: user.username, role: user.role, display_name: user.display_name || '' };
}

/** Express middleware: require a valid Bearer token for an active account. */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = await authenticateToken(token);
    return next();
  } catch (e) {
    if (e instanceof AuthError) return res.status(401).json({ error: e.message });
    logger.error('Auth check failed', e);
    return res.status(503).json({ error: 'Service unavailable' });
  }
}

/** Express middleware: require an admin token. Assumes requireAuth ran first. */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin privileges required' });
  }
  return next();
}

module.exports = {
  AuthError,
  signToken,
  verifyToken,
  authenticateToken,
  hashPassword,
  comparePassword,
  requireAuth,
  requireAdmin,
};
