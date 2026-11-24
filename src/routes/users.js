'use strict';

const express = require('express');
const db = require('../config/database');
const users = require('../services/users');
const {
  requireAuth, requireAdmin, hashPassword, signToken,
} = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth, requireAdmin);

/** Express 4 does not catch rejected promises — route them to the error handler. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function fail(res, status, code, error) {
  return res.status(status).json({ code, error });
}

function parseId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    fail(res, 400, 'invalid_id', 'Invalid id');
    return null;
  }
  return id;
}

/** GET /api/users — all accounts (no password hashes). */
router.get('/', wrap(async (req, res) => {
  const rows = await users.list();
  res.json(rows.map(users.toPublic));
}));

/** Which unique key a MySQL duplicate-entry error hit. */
function duplicateCode(e) {
  return /uq_users_email/.test(String(e && e.message)) ? ['email_taken', 'Email already registered']
    : ['username_taken', 'Username already registered'];
}

/**
 * POST /api/users — { username, password?, email?, role, display_name }
 * An account needs at least one way to sign in: a password, an institutional
 * email (Google sign-in), or both. Email-only accounts have no password.
 */
router.post('/', wrap(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  const displayName = users.cleanDisplayName(req.body.display_name);
  const mail = users.normalizeEmail(req.body.email);

  if (!users.USERNAME_RE.test(username)) {
    return fail(res, 400, 'invalid_username', 'Invalid username (3-64 chars: letters, digits, . _ -)');
  }
  if (mail.code) return res.status(400).json({ code: mail.code, error: mail.error });
  if (!password && !mail.email) {
    return fail(res, 400, 'login_method_required', 'Set a password or an institutional email (Google sign-in)');
  }
  if (password) {
    const invalid = users.validatePassword(password, username);
    if (invalid) return res.status(400).json(invalid);
  }

  const existing = await db.query('SELECT id FROM users WHERE username = ?', [username]);
  if (existing.length) return fail(res, 409, 'username_taken', 'Username already registered');
  if (mail.email && (await users.findByEmail(mail.email))) return fail(res, 409, 'email_taken', 'Email already registered');

  try {
    const result = await db.query(
      'INSERT INTO users (username, display_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [username, displayName, mail.email, password ? await hashPassword(password) : null, role]
    );
    logger.info(`User created: ${username} (${role}${mail.email ? ', Google sign-in' : ''}) by ${req.user.sub}`);
    const created = await users.findById(result.insertId);
    return res.status(201).json(users.toPublic(created));
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') return fail(res, 409, ...duplicateCode(e));
    throw e;
  }
}));

/**
 * PATCH /api/users/:id — { display_name?, email?, role?, is_active? }
 * An admin cannot change their own role or disable themselves, and the last
 * active admin can never be demoted or disabled (no lock-out).
 */
router.patch('/:id', wrap(async (req, res) => {
  const id = parseId(req, res);
  if (id === null) return undefined;
  const target = await users.findById(id);
  if (!target) return fail(res, 404, 'not_found', 'User not found');

  const sets = [];
  const params = [];
  const changes = [];

  if ('display_name' in req.body) {
    sets.push('display_name = ?');
    params.push(users.cleanDisplayName(req.body.display_name));
  }

  if ('email' in req.body) {
    const mail = users.normalizeEmail(req.body.email);
    if (mail.code) return res.status(400).json({ code: mail.code, error: mail.error });
    // Never leave an account without any way to sign in.
    if (!mail.email && !target.has_password) {
      return fail(res, 400, 'login_method_required', 'This account has no password; it needs its email for Google sign-in');
    }
    if (mail.email !== (target.email || null)) {
      if (mail.email) {
        const other = await users.findByEmail(mail.email);
        if (other && other.id !== id) return fail(res, 409, 'email_taken', 'Email already registered');
      }
      sets.push('email = ?');
      params.push(mail.email);
      changes.push(mail.email ? 'email set' : 'email removed');
    }
  }

  let nextRole = target.role;
  if ('role' in req.body) {
    if (!users.ROLES.includes(req.body.role)) return fail(res, 400, 'invalid_role', 'Invalid role');
    nextRole = req.body.role;
  }
  let nextActive = Boolean(target.is_active);
  if ('is_active' in req.body) {
    if (typeof req.body.is_active !== 'boolean') return fail(res, 400, 'invalid_status', 'is_active must be boolean');
    nextActive = req.body.is_active;
  }

  const isSelf = id === req.user.uid;
  if (isSelf && nextRole !== target.role) return fail(res, 400, 'self_role', 'You cannot change your own role');
  if (isSelf && !nextActive) return fail(res, 400, 'self_disable', 'You cannot disable your own account');

  const losesAdmin = target.role === 'admin' && Boolean(target.is_active) && (nextRole !== 'admin' || !nextActive);

  if (nextRole !== target.role) {
    sets.push('role = ?');
    params.push(nextRole);
    changes.push(`role=${nextRole}`);
  }
  if (nextActive !== Boolean(target.is_active)) {
    sets.push('is_active = ?');
    params.push(nextActive ? 1 : 0);
    changes.push(nextActive ? 'enabled' : 'disabled');
  }

  if (sets.length) {
    let blocked;
    try {
      blocked = await users.withAdminLock(async (conn, adminIds) => {
        if (losesAdmin && adminIds.filter((a) => a !== id).length === 0) return true;
        await conn.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
        return false;
      });
    } catch (e) {
      if (e && e.code === 'ER_DUP_ENTRY') return fail(res, 409, ...duplicateCode(e));
      throw e;
    }
    if (blocked) return fail(res, 400, 'last_admin', 'At least one active admin is required');
    logger.info(`User updated: ${target.username}${changes.length ? ` (${changes.join(', ')})` : ''} by ${req.user.sub}`);
  }
  return res.json(users.toPublic(await users.findById(id)));
}));

/**
 * PUT /api/users/:id/password — { new_password }
 * Admin reset. Signs the account out everywhere (token_version bump).
 */
router.put('/:id/password', wrap(async (req, res) => {
  const id = parseId(req, res);
  if (id === null) return undefined;
  const target = await users.findById(id);
  if (!target) return fail(res, 404, 'not_found', 'User not found');

  const newPassword = String(req.body.new_password || '');
  const invalid = users.validatePassword(newPassword, target.username);
  if (invalid) return res.status(400).json(invalid);

  await users.setPasswordHash(id, await hashPassword(newPassword));
  logger.info(`Password reset: ${target.username} by ${req.user.sub}`);
  // Resetting your own password must not sign you out of this tab.
  if (id === req.user.uid) {
    return res.json({ detail: 'Password updated successfully', access_token: signToken(await users.findById(id)) });
  }
  return res.json({ detail: 'Password updated successfully' });
}));

/** DELETE /api/users/:id */
router.delete('/:id', wrap(async (req, res) => {
  const id = parseId(req, res);
  if (id === null) return undefined;
  if (id === req.user.uid) return fail(res, 400, 'self_delete', 'You cannot delete yourself');
  const target = await users.findById(id);
  if (!target) return fail(res, 404, 'not_found', 'User not found');
  const blocked = await users.withAdminLock(async (conn, adminIds) => {
    if (adminIds.includes(id) && adminIds.length === 1) return true;
    await conn.query('DELETE FROM users WHERE id = ?', [id]);
    return false;
  });
  if (blocked) return fail(res, 400, 'last_admin', 'At least one active admin is required');
  logger.info(`User deleted: ${target.username} by ${req.user.sub}`);
  return res.json({ detail: 'User deleted' });
}));

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  logger.error('User management error', err);
  res.status(500).json({ error: 'Internal error' });
});

module.exports = router;
