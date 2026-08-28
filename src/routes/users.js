'use strict';

const express = require('express');
const db = require('../config/database');
const { requireAuth, requireAdmin, hashPassword } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,64}$/;

router.get('/', async (req, res) => {
  const rows = await db.query('SELECT id, username, role, created_at FROM users ORDER BY id ASC');
  res.json(rows);
});

router.post('/', async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Invalid username (3-64 chars: letters, digits, . _ -)' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Password too short' });
  }
  try {
    const existing = await db.query('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length) return res.status(400).json({ error: 'Username already registered' });
    const hash = await hashPassword(password);
    const result = await db.query(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      [username, hash, role]
    );
    logger.info(`User created: ${username} (${role})`);
    res.json({ id: result.insertId, username, role });
  } catch (e) {
    logger.error('Create user error', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  if (id === req.user.uid) return res.status(400).json({ error: 'Cannot delete yourself' });
  await db.query('DELETE FROM users WHERE id = ?', [id]);
  logger.info(`User deleted: id=${id}`);
  res.json({ detail: 'User deleted' });
});

router.put('/:id/password', async (req, res) => {
  const id = Number(req.params.id);
  const newPassword = req.body.new_password || '';
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  if (newPassword.length < 4) return res.status(400).json({ error: 'Password too short' });
  const hash = await hashPassword(newPassword);
  await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
  logger.info(`Password updated: id=${id}`);
  res.json({ detail: 'Password updated successfully' });
});

module.exports = router;
