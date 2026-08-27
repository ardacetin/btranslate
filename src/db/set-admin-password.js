'use strict';

/**
 * Reset (or create) the admin account's password from ADMIN_PASSWORD in .env.
 *
 *   npm run set-admin-password
 *
 * Why this exists: the migration seeds the admin user only once (on the first
 * `npm run migrate`). Changing ADMIN_PASSWORD in .env afterwards does NOT change
 * an already-seeded admin. Run this command to force the admin password to the
 * current ADMIN_PASSWORD value.
 *
 * Optionally pass a password directly:
 *   node src/db/set-admin-password.js "MyNewStrongPass"
 */
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const config = require('../config');
const logger = require('../utils/logger');

async function run() {
  const password = process.argv[2] || config.auth.adminPassword;
  if (!password) {
    logger.error('No password provided. Set ADMIN_PASSWORD in .env or pass it as an argument.');
    process.exit(1);
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
      await conn.execute('UPDATE users SET password_hash = ? WHERE username = ?', [hash, 'admin']);
      logger.info("Admin password reset from ADMIN_PASSWORD.");
    } else {
      await conn.execute(
        'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
        ['admin', hash, 'admin']
      );
      logger.info('Admin user created with password from ADMIN_PASSWORD.');
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
