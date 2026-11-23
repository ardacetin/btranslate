'use strict';

const mysql = require('mysql2/promise');
const config = require('./index');
const logger = require('../utils/logger');

/**
 * Shared MySQL connection pool. All queries use parameterized statements
 * (`pool.execute(sql, params)`) which protects against SQL injection.
 */
let pool = null;

// Every connection works in UTC so DEFAULT CURRENT_TIMESTAMP columns, NOW(),
// UTC_TIMESTAMP() and the JS Dates mysql2 writes (timezone: 'Z') all agree,
// whatever the MySQL server's own time zone is. Human-facing formatting in
// APP_TIMEZONE happens in utils/time.js.
const UTC_SESSION_SQL = "SET time_zone = '+00:00'";

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.name,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: 'utf8mb4',
      timezone: 'Z',
    });
    // Runs on each new physical connection before it is handed out; mysql2
    // queues commands per connection, so this precedes the first real query.
    pool.on('connection', (conn) => {
      conn.query(UTC_SESSION_SQL, (err) => {
        if (err) logger.error('Failed to set UTC session time zone', err);
      });
    });
  }
  return pool;
}

async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

async function ping() {
  const conn = await getPool().getConnection();
  try {
    await conn.ping();
    return true;
  } finally {
    conn.release();
  }
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { getPool, query, ping, close, logger, UTC_SESSION_SQL };
