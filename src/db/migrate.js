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
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const config = require('../config');
const logger = require('../utils/logger');

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

async function seedAdmin(conn) {
  const [rows] = await conn.query('SELECT COUNT(*) AS c FROM users');
  if (rows[0].c > 0) return;
  const hash = await bcrypt.hash(config.auth.adminPassword, 10);
  await conn.execute(
    'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
    ['admin', hash, 'admin']
  );
  if (config.auth.adminPassword === 'admin123') {
    logger.warn("Admin user seeded with default password 'admin123' — change it via the dashboard.");
  } else {
    logger.info('Admin user seeded with password from ADMIN_PASSWORD.');
  }
}

async function run() {
  // Connect without a database first, so we can create it if missing.
  const rootConn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: true,
  });

  try {
    await ensureDatabase(rootConn);
    await rootConn.changeUser({ database: config.db.name });
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
