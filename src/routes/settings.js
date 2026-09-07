'use strict';

const express = require('express');
const settings = require('../services/settings');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Any authenticated host may read settings (the host page applies them).
router.get('/', requireAuth, async (req, res) => {
  res.json(await settings.getAll());
});

// Only admins may change them.
router.put('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const updated = await settings.setMany(req.body || {});
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

module.exports = router;
