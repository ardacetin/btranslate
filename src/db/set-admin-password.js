'use strict';

/**
 * Reset (or create) the admin account's password.
 *
 *   npm run set-admin-password
 *
 * Why this exists: the migration seeds the admin user only once (on the first
 * `npm run migrate`). Changing ADMIN_PASSWORD in .env afterwards does NOT change
 * an already-seeded admin. This command sets the admin password explicitly.
 * It also re-enables the account, restores its admin role and signs out all
 * existing sessions, so it doubles as a lock-out recovery tool.
 *
 * Where the password comes from (first match wins):
 *   1. ADMIN_PASSWORD in the environment / .env
 *   2. an interactive hidden prompt (when run in a terminal)
 *   3. a command-line argument — still accepted for scripts, but it ends up
 *      in shell history and the process list, so prefer 1 or 2:
 *        node src/db/set-admin-password.js "MyNewStrongPass"
 * There is no default: without a password the command fails.
 */
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { validatePassword } = require('../services/users');
const logger = require('../utils/logger');

const KNOWN_DEFAULT_PASSWORDS = ['admin123'];

/** Read a line from the terminal without echoing it. */
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    let input = '';
    const finish = (err) => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      if (err) reject(err);
      else resolve(input);
    };
    function onData(chunk) {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish();
        if (ch === '\u0003' || ch === '\u0004') return finish(new Error('Cancelled')); // Ctrl+C / Ctrl+D
        if (ch === '\u007f' || ch === '\b') {
          input = Array.from(input).slice(0, -1).join('');
        } else if (ch >= ' ') {
          input += ch;
        }
      }
      return undefined;
    }
    stdout.write(question);
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function obtainPassword() {
  if (config.auth.adminPassword) {
    if (process.argv[2]) logger.warn('Both ADMIN_PASSWORD and an argument were given — using ADMIN_PASSWORD.');
    return { password: config.auth.adminPassword, source: 'ADMIN_PASSWORD' };
  }
  if (process.stdin.isTTY && process.stdout.isTTY && !process.argv[2]) {
    const first = await promptHidden('New admin password: ');
    const second = await promptHidden('Repeat password: ');
    if (first !== second) throw new Error('Passwords do not match.');
    return { password: first, source: 'prompt' };
  }
  if (process.argv[2]) {
    logger.warn(
      'Password passed as a command-line argument — it is visible in shell history and the process list. ' +
        'Prefer ADMIN_PASSWORD or the interactive prompt, and clear your shell history.'
    );
    return { password: process.argv[2], source: 'argument' };
  }
  throw new Error('No password provided. Set ADMIN_PASSWORD, run this in a terminal to be prompted, or pass it as an argument.');
}

async function run() {
  const { password, source } = await obtainPassword();
  const invalid = validatePassword(password, 'admin');
  if (invalid) throw new Error(invalid.error);
  if (KNOWN_DEFAULT_PASSWORDS.includes(password.toLowerCase())) {
    throw new Error('That is a well-known default password — choose another one.');
  }

  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.name,
  });

  try {
    const hash = await bcrypt.hash(password, 10);
    const [rows] = await conn.execute('SELECT id FROM users WHERE username = ? LIMIT 1', ['admin']);
    if (rows.length) {
      // Recovery path: also make sure the account is an enabled admin and sign
      // out any existing sessions. Falls back for databases that have not run
      // migration 004 yet (no is_active / token_version columns).
      try {
        await conn.execute(
          "UPDATE users SET password_hash = ?, role = 'admin', is_active = 1, token_version = token_version + 1 WHERE username = ?",
          [hash, 'admin']
        );
      } catch (e) {
        if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
        await conn.execute("UPDATE users SET password_hash = ?, role = 'admin' WHERE username = ?", [hash, 'admin']);
      }
      logger.info(`Admin password reset from ${source} (account enabled, role admin, sessions signed out).`);
    } else {
      await conn.execute(
        'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
        ['admin', hash, 'admin']
      );
      logger.info(`Admin user created with password from ${source}.`);
    }
    logger.info('Done. You can now log in as: admin');
  } finally {
    await conn.end();
  }
}

run().then(() => process.exit(0)).catch((e) => {
  logger.error('Failed to set admin password', e);
  process.exit(1);
});
