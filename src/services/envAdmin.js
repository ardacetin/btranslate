'use strict';

const bcrypt = require('bcryptjs');
const config = require('../config');
const db = require('../config/database');
const users = require('./users');
const logger = require('../utils/logger');

/**
 * ADMIN_USERNAME / ADMIN_PASSWORD in .env are the source of truth for the
 * built-in admin account. On every server start:
 *   - the account is created if it does not exist,
 *   - its password is reset to ADMIN_PASSWORD when it differs (all of its
 *     open sessions are signed out),
 *   - it is (re)made an active admin.
 * The panel cannot change this account's password, role or status, nor
 * delete it — the next restart would undo it anyway. Changing the password
 * is: edit ADMIN_PASSWORD in .env, restart.
 *
 * Without ADMIN_PASSWORD (or with an unacceptable one) nothing is managed and
 * the account behaves like any other.
 */
async function syncEnvAdmin() {
  const username = config.auth.adminUsername;
  const password = config.auth.adminPassword;
  users.setEnvAdminUsername(null);
  if (!password) return 'off';
  if (!users.USERNAME_RE.test(username)) {
    logger.warn(`ADMIN_USERNAME "${username}" is not a valid username — .env admin is not managed.`);
    return 'invalid';
  }
  const problem = users.adminPasswordProblem(password, username);
  if (problem) {
    logger.warn(`${problem} — the .env admin account is NOT managed until this is fixed.`);
    return 'invalid';
  }

  const row = await users.findByUsernameWithHash(username);
  if (!row) {
    await db.query(
      "INSERT INTO users (username, display_name, password_hash, role, is_active) VALUES (?, ?, ?, 'admin', 1)",
      [username, 'Yönetici', await bcrypt.hash(password, 10)]
    );
    logger.info(`Admin account "${username}" created from .env.`);
  } else {
    const samePassword = Boolean(row.password_hash) && (await bcrypt.compare(password, row.password_hash));
    if (!samePassword) {
      await db.query(
        "UPDATE users SET password_hash = ?, role = 'admin', is_active = 1, token_version = token_version + 1 WHERE id = ?",
        [await bcrypt.hash(password, 10), row.id]
      );
      logger.info(`Admin password for "${username}" updated from .env (its sessions were signed out).`);
    } else if (row.role !== 'admin' || !row.is_active) {
      await db.query("UPDATE users SET role = 'admin', is_active = 1 WHERE id = ?", [row.id]);
      logger.info(`Admin account "${username}" re-enabled as admin from .env.`);
    }
  }
  users.setEnvAdminUsername(username);
  return 'synced';
}

module.exports = { syncEnvAdmin };
