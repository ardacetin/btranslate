'use strict';

const db = require('../config/database');
const config = require('../config');

/**
 * User account data access + validation rules, shared by the auth middleware,
 * the auth routes (login / self-service) and the admin user-management routes.
 */
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,64}$/;
const ROLES = ['admin', 'user'];
const PASSWORD_MIN = 8;
const PASSWORD_MAX_BYTES = 72; // bcrypt ignores everything past 72 bytes
const DISPLAY_NAME_MAX = 128;
const EMAIL_MAX = 255;

const PUBLIC_COLUMNS =
  'id, username, display_name, email, role, is_active, token_version, last_login_at, created_at, ' +
  '(password_hash IS NOT NULL) AS has_password';

/** Shape a DB row for API responses (never includes the password hash). */
function toPublic(u) {
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name || '',
    email: u.email || '',
    has_password: Boolean(u.has_password),
    role: u.role,
    is_active: Boolean(u.is_active),
    last_login_at: u.last_login_at || null,
    created_at: u.created_at || null,
  };
}

/** Returns { code, error } describing the problem, or null when the password is acceptable. */
function validatePassword(password, username) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
    return { code: 'password_too_short', error: `Password must be at least ${PASSWORD_MIN} characters` };
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return { code: 'password_too_long', error: `Password must be at most ${PASSWORD_MAX_BYTES} bytes` };
  }
  if (username && password.toLowerCase() === String(username).toLowerCase()) {
    return { code: 'password_equals_username', error: 'Password must not be the same as the username' };
  }
  return null;
}

/**
 * Normalize an institutional email for storage/lookup (trim + lowercase).
 * Returns { email } (null when empty) or { code, error } when it is not an
 * address on the allowed Google Workspace domain.
 */
function normalizeEmail(raw) {
  const email = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!email) return { email: null };
  const domain = config.sso.emailDomain;
  const local = email.endsWith(`@${domain}`) ? email.slice(0, -(domain.length + 1)) : '';
  if (!local || email.length > EMAIL_MAX || !/^[a-z0-9._%+-]+$/.test(local)) {
    return { code: 'invalid_email', error: `Email must be an address on @${domain}` };
  }
  return { email };
}

async function findByEmail(email) {
  const rows = await db.query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE email = ? LIMIT 1`, [email]);
  return rows[0] || null;
}

/** Trim + clamp a display name; empty becomes null. */
function cleanDisplayName(v) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, DISPLAY_NAME_MAX);
  return s || null;
}

async function list() {
  return db.query(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY id ASC`);
}

async function findById(id) {
  const rows = await db.query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

async function findByUsernameWithHash(username) {
  const rows = await db.query(
    `SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE username = ? LIMIT 1`,
    [username]
  );
  return rows[0] || null;
}

async function findByIdWithHash(id) {
  const rows = await db.query(
    `SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Run `fn(conn)` in a transaction that first locks every active admin row, so
 * "is this the last active admin?" and the change that depends on it are
 * atomic: two admins demoting/disabling each other at the same moment can't
 * both succeed and leave zero admins. `conn.query(sql, params)` returns rows.
 */
async function withAdminLock(fn) {
  const conn = await db.getPool().getConnection();
  const q = async (sql, params = []) => (await conn.execute(sql, params))[0];
  try {
    await conn.beginTransaction();
    const admins = await q(
      "SELECT id FROM users WHERE role = 'admin' AND is_active = 1 FOR UPDATE"
    );
    const result = await fn({ query: q }, admins.map((r) => r.id));
    await conn.commit();
    return result;
  } catch (e) {
    try { await conn.rollback(); } catch (ignored) { /* connection may be gone */ }
    throw e;
  } finally {
    conn.release();
  }
}

/** Set a new password hash and revoke every token issued before. */
async function setPasswordHash(id, hash) {
  await db.query(
    'UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?',
    [hash, id]
  );
}

async function touchLastLogin(id) {
  await db.query('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?', [id]);
}

module.exports = {
  USERNAME_RE,
  ROLES,
  PASSWORD_MIN,
  DISPLAY_NAME_MAX,
  toPublic,
  validatePassword,
  cleanDisplayName,
  normalizeEmail,
  findByEmail,
  list,
  findById,
  findByUsernameWithHash,
  findByIdWithHash,
  withAdminLock,
  setPasswordHash,
  touchLastLogin,
};
