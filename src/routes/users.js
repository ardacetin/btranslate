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
 * Username for a new account, from its email's local part (made valid and
 * unique: "ad.soyad", then "ad.soyad-2", …).
 */
async function usernameFromEmail(email) {
  let base = email.split('@')[0].replace(/[^a-z0-9._-]/g, '').slice(0, 60);
  if (base.length < 3) base = base.padEnd(3, '_');
  for (let n = 1; n < 1000; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const taken = await db.query('SELECT id FROM users WHERE username = ? LIMIT 1', [candidate]);
    if (!taken.length) return candidate;
  }
  return `${base.slice(0, 50)}-${Date.now().toString(36)}`;
}

/**
 * POST /api/users — { email, display_name?, username?, password? }
 * Panel accounts are added by their institutional email only: every account
 * is an admin that signs in with Google. The username is derived from the
 * email unless given; a password is optional (API only).
 */
router.post('/', wrap(async (req, res) => {
  const password = String(req.body.password || '');
  const role = 'admin';
  const displayName = users.cleanDisplayName(req.body.display_name);
  const mail = users.normalizeEmail(req.body.email);

  if (mail.code) return res.status(400).json({ code: mail.code, error: mail.error });
  if (!mail.email) return fail(res, 400, 'email_required', 'An institutional email is required');
  if (await users.findByEmail(mail.email)) return fail(res, 409, 'email_taken', 'Email already registered');

  let username = String(req.body.username || '').trim();
  if (username) {
    if (!users.USERNAME_RE.test(username)) {
      return fail(res, 400, 'invalid_username', 'Invalid username (3-64 chars: letters, digits, . _ -)');
    }
    const existing = await db.query('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length) return fail(res, 409, 'username_taken', 'Username already registered');
  } else {
    username = await usernameFromEmail(mail.email);
  }
  if (password) {
    const invalid = users.validatePassword(password, username);
    if (invalid) return res.status(400).json(invalid);
  }

  try {
    const result = await db.query(
      'INSERT INTO users (username, display_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [username, displayName, mail.email, password ? await hashPassword(password) : null, role]
    );
    logger.info(`User created: ${username} <${mail.email}> by ${req.user.sub}`);
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

  let nextEmail = target.email || null;
  if ('email' in req.body) {
    const mail = users.normalizeEmail(req.body.email);
    if (mail.code) return res.status(400).json({ code: mail.code, error: mail.error });
    nextEmail = mail.email;
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

  // The .env admin's role and status come from .env.
  if (users.isEnvManaged(target) && (nextRole !== 'admin' || !nextActive)) {
    return fail(res, 400, 'env_managed', 'This admin account is managed in .env (ADMIN_USERNAME / ADMIN_PASSWORD)');
  }
  // Google sign-in is for admins only, and an account must keep a way in.
  if (nextEmail && nextRole !== 'admin') {
    return fail(res, 400, 'email_admin_only', 'Google sign-in (email) is only for admin accounts; remove the email first');
  }
  if (!nextEmail && !target.has_password) {
    return fail(res, 400, 'login_method_required', 'This account has no password; it needs its email for Google sign-in');
  }
  if (nextEmail !== (target.email || null)) {
    if (nextEmail) {
      const other = await users.findByEmail(nextEmail);
      if (other && other.id !== id) return fail(res, 409, 'email_taken', 'Email already registered');
    }
    sets.push('email = ?');
    params.push(nextEmail);
    changes.push(nextEmail ? 'email set' : 'email removed');
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
  if (users.isEnvManaged(target)) {
    return fail(res, 400, 'env_managed', 'This admin password is managed in .env (ADMIN_PASSWORD)');
  }

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
  if (users.isEnvManaged(target)) {
    return fail(res, 400, 'env_managed', 'This admin account is managed in .env (ADMIN_USERNAME / ADMIN_PASSWORD)');
  }
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
