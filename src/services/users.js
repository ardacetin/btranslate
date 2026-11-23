'use strict';

const db = require('../config/database');

/**
 * User account data access + validation rules, shared by the auth middleware,
 * the auth routes (login / self-service) and the admin user-management routes.
 */
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,64}$/;
const ROLES = ['admin', 'user'];
const PASSWORD_MIN = 8;
const PASSWORD_MAX_BYTES = 72; // bcrypt ignores everything past 72 bytes
const DISPLAY_NAME_MAX = 128;

const PUBLIC_COLUMNS =
  'id, username, display_name, role, is_active, token_version, last_login_at, created_at';

/** Shape a DB row for API responses (never includes the password hash). */
function toPublic(u) {
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name || '',
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

/** Number of active admins, optionally excluding one user id. */
async function countActiveAdmins(excludeId = null) {
  const rows = excludeId == null
    ? await db.query("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1")
    : await db.query(
      "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?",
      [excludeId]
    );
  return Number(rows[0].c) || 0;
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
  list,
  findById,
  findByUsernameWithHash,
  findByIdWithHash,
  countActiveAdmins,
  setPasswordHash,
  touchLastLogin,
};
