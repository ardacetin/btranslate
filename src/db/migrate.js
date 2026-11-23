'use strict';

/**
 * Minimal, dependency-free migration runner.
 *
 *   npm run migrate
 *
 * Applies every .sql file in ./migrations (in filename order) exactly once,
 * tracking applied files in a `schema_migrations` table. Also seeds the
 * initial admin user. Safe to run repeatedly (idempotent).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { UTC_SESSION_SQL } = require('../config/database');
const { validatePassword } = require('../services/users');
const logger = require('../utils/logger');

// Passwords that were shipped as defaults and must never be (re)used.
const KNOWN_DEFAULT_PASSWORDS = ['admin123'];

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureDatabase(rootConn) {
  await rootConn.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.db.name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
}

async function ensureMigrationsTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function appliedSet(conn) {
  const [rows] = await conn.query('SELECT filename FROM schema_migrations');
  return new Set(rows.map((r) => r.filename));
}

/** Why ADMIN_PASSWORD cannot be used, or null when it is acceptable. */
function adminPasswordProblem(pw) {
  if (!pw) return 'ADMIN_PASSWORD is not set';
  if (KNOWN_DEFAULT_PASSWORDS.includes(pw.toLowerCase())) return 'ADMIN_PASSWORD is a well-known default';
  const invalid = validatePassword(pw, 'admin');
  return invalid ? `ADMIN_PASSWORD rejected: ${invalid.error}` : null;
}

/**
 * Print a generated password once, to stdout only. Deliberately not via the
 * logger: logger lines can end up in the DB log viewer, a password must not.
 */
function announceGeneratedPassword(password) {
  const bar = '='.repeat(64);
  console.log(`\n${bar}`);
  console.log('  Admin account created with a RANDOM password (shown only once):');
  console.log('');
  console.log('    username: admin');
  console.log(`    password: ${password}`);
  console.log('');
  console.log('  Store it now, then change it in the dashboard, or set a new one');
  console.log('  with `npm run set-admin-password`.');
  console.log(`${bar}\n`);
}

async function seedAdmin(conn) {
  const [rows] = await conn.query('SELECT COUNT(*) AS c FROM users');
  if (rows[0].c > 0) {
    await warnIfDefaultAdminPassword(conn);
    return;
  }

  let password = config.auth.adminPassword;
  const problem = adminPasswordProblem(password);
  if (problem) {
    logger.warn(`${problem} — generating a random admin password instead.`);
    password = crypto.randomBytes(18).toString('base64url'); // 24 chars, ~144 bits
  }

  const hash = await bcrypt.hash(password, 10);
  await conn.execute(
    'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
    ['admin', hash, 'admin']
  );
  if (problem) {
    announceGeneratedPassword(password);
  } else {
    logger.info('Admin user seeded with password from ADMIN_PASSWORD.');
  }
}

/**
 * Existing installs may still have the admin seeded with the old default
 * password. Do not change credentials behind the operator's back, but say it
 * loudly on every migrate run.
 */
async function warnIfDefaultAdminPassword(conn) {
  const [rows] = await conn.execute('SELECT password_hash FROM users WHERE username = ? LIMIT 1', ['admin']);
  if (!rows.length) return;
  for (const pw of KNOWN_DEFAULT_PASSWORDS) {
    if (await bcrypt.compare(pw, rows[0].password_hash)) {
      logger.warn(
        "The 'admin' account still uses the default password — change it now (dashboard or `npm run set-admin-password`)."
      );
      return;
    }
  }
}

async function run() {
  if (!config.db.user) logger.warn('DB_USER is empty — set the MySQL user for this app in .env.');
  // Connect without a database first, so we can create it if missing.
  const rootConn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: true,
    timezone: 'Z',
  });

  try {
    // On managed panels (CloudPanel/Plesk) the DB is created for you and the
    // app user usually lacks the global CREATE privilege — so a failure here
    // is expected and safe to ignore as long as the database already exists.
    try {
      await ensureDatabase(rootConn);
    } catch (e) {
      logger.warn(`Could not CREATE DATABASE (likely already exists / limited privileges): ${e.message}`);
    }
    await rootConn.changeUser({ database: config.db.name });
    // Same UTC session as the app pool, so DEFAULT CURRENT_TIMESTAMP values
    // written by migrations/seeding are UTC too. (After changeUser: a
    // COM_CHANGE_USER resets session variables.)
    await rootConn.query(UTC_SESSION_SQL);
    await ensureMigrationsTable(rootConn);

    const done = await appliedSet(rootConn);
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let applied = 0;
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      logger.info(`Applying migration: ${file}`);
      await rootConn.query(sql);
      await rootConn.execute('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
      applied += 1;
    }

    await seedAdmin(rootConn);

    logger.info(applied === 0 ? 'Database up to date — no new migrations.' : `Applied ${applied} migration(s).`);
  } finally {
    await rootConn.end();
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Migration failed', err);
    process.exit(1);
  });
