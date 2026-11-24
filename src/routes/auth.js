'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const users = require('../services/users');
const {
  signToken, comparePassword, hashPassword, requireAuth,
} = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Compared against when the username does not exist, so a login attempt takes
// about the same time either way (no username enumeration via timing).
const DUMMY_HASH = bcrypt.hashSync('btranslate-timing-equalizer', 10);

/**
 * POST /api/auth/login
 * Accepts either form-urlencoded (username/password) or JSON — matches the
 * existing frontend which posts x-www-form-urlencoded.
 */
router.post('/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  try {
    const user = await users.findByUsernameWithHash(username);
    // Google-only accounts have no password: compare against the dummy hash so
    // they fail exactly like a wrong password (same message, same timing).
    const ok = await comparePassword(password, (user && user.password_hash) || DUMMY_HASH) && Boolean(user && user.password_hash);
    if (!user || !ok) {
      logger.warn(`Failed login for "${username.slice(0, 64)}"`);
      return res.status(401).json({ error: 'Incorrect username or password' });
    }
    if (!user.is_active) {
      logger.warn(`Login refused, account disabled: ${user.username}`);
      return res.status(403).json({ code: 'account_disabled', error: 'This account is disabled' });
    }
    await users.touchLastLogin(user.id);
    const token = signToken(user);
    logger.info(`Host login: ${user.username}`);
    return res.json({
      access_token: token,
      token_type: 'bearer',
      role: user.role,
      username: user.username,
      display_name: user.display_name || '',
    });
  } catch (e) {
    logger.error('Login error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

/** Current account (fresh from the DB). */
router.get('/me', requireAuth, (req, res) => {
  res.json({
    status: 'ok',
    id: req.user.uid,
    username: req.user.sub,
    display_name: req.user.display_name,
    email: req.user.email,
    has_password: req.user.has_password,
    env_managed: req.user.env_managed,
    role: req.user.role,
  });
});

/**
 * POST /api/auth/change-password  { current_password, new_password }
 * Self-service for every signed-in user. Revokes all existing tokens of the
 * account (other devices are signed out) and returns a fresh token for this one.
 */
router.post('/change-password', requireAuth, async (req, res) => {
  const current = String(req.body.current_password || '');
  const next = String(req.body.new_password || '');
  try {
    const user = await users.findByIdWithHash(req.user.uid);
    if (user && users.isEnvManaged(user)) {
      return res.status(400).json({ code: 'env_managed', error: 'This admin password is managed in .env (ADMIN_PASSWORD)' });
    }
    if (user && !user.password_hash) {
      return res.status(400).json({ code: 'no_password', error: 'This account signs in with Google and has no password' });
    }
    if (!user || !(await comparePassword(current, user.password_hash))) {
      return res.status(400).json({ code: 'wrong_current_password', error: 'Current password is incorrect' });
    }
    const invalid = users.validatePassword(next, user.username);
    if (invalid) return res.status(400).json(invalid);
    if (await comparePassword(next, user.password_hash)) {
      return res.status(400).json({ code: 'password_unchanged', error: 'New password must differ from the current one' });
    }
    await users.setPasswordHash(user.id, await hashPassword(next));
    const fresh = await users.findById(user.id);
    logger.info(`Password changed by user: ${user.username}`);
    return res.json({ detail: 'Password changed', access_token: signToken(fresh) });
  } catch (e) {
    logger.error('Change password error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
