'use strict';

const express = require('express');
const db = require('../config/database');
const { signToken, comparePassword, requireAuth } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * POST /api/auth/login
 * Accepts either form-urlencoded (username/password) or JSON — matches the
 * existing frontend which posts x-www-form-urlencoded.
 */
router.post('/login', async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  try {
    const rows = await db.query('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
    const user = rows[0];
    if (!user || !(await comparePassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Incorrect username or password' });
    }
    const token = signToken(user);
    logger.info(`Host login: ${username}`);
    return res.json({ access_token: token, token_type: 'bearer', role: user.role });
  } catch (e) {
    logger.error('Login error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ status: 'ok', role: req.user.role });
});

module.exports = router;
