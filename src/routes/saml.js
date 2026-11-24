'use strict';

const express = require('express');
const config = require('../config');
const sso = require('../services/sso');
const users = require('../services/users');
const { signToken, requireAuth, requireAdmin } = require('../middleware/auth');
const { wrap } = require('../utils/asyncHandler');
const logger = require('../utils/logger');

/**
 * Google Workspace SAML sign-in (see services/sso.js for the flow and the
 * checks applied to every response).
 */
const router = express.Router();

/** Back to the panel with a result in the URL fragment (not sent to servers). */
function backToPanel(res, fragment) {
  res.redirect(303, `/host#${fragment}`);
}

/** Public: should the login screen offer "Sign in with Google"? */
router.get('/status', (req, res) => {
  res.json({ enabled: sso.enabled(), domain: config.sso.emailDomain });
});

/** Start: redirect the browser to Google with a fresh AuthnRequest. */
router.get('/login', wrap(async (req, res) => {
  if (!sso.enabled()) return backToPanel(res, 'sso_error=disabled');
  return res.redirect(302, await sso.loginUrl());
}));

/** Assertion Consumer Service: Google posts the signed SAMLResponse here. */
router.post('/acs', express.urlencoded({ extended: false, limit: '512kb' }), wrap(async (req, res) => {
  if (!sso.enabled()) return backToPanel(res, 'sso_error=disabled');

  let email;
  try {
    email = await sso.verifyResponse(req.body && req.body.SAMLResponse);
  } catch (e) {
    logger.warn(`Google sign-in refused: invalid SAML response (${String(e.message).slice(0, 160)})`);
    return backToPanel(res, 'sso_error=invalid');
  }

  const mail = users.normalizeEmail(email);
  if (mail.code || !mail.email) {
    logger.warn(`Google sign-in refused: ${email} is not on @${config.sso.emailDomain}`);
    return backToPanel(res, 'sso_error=domain');
  }
  const user = await users.findByEmail(mail.email);
  if (!user) {
    logger.warn(`Google sign-in refused: no panel account for ${mail.email}`);
    return backToPanel(res, 'sso_error=not_registered');
  }
  if (!user.is_active) {
    logger.warn(`Google sign-in refused: account disabled (${user.username})`);
    return backToPanel(res, 'sso_error=disabled_account');
  }

  logger.info(`Google sign-in verified: ${user.username}`);
  return backToPanel(res, `sso=${sso.issueCode(user.id)}`);
}));

/** The panel trades the single-use code for its token. */
router.post('/exchange', express.json({ limit: '4kb' }), wrap(async (req, res) => {
  const uid = sso.redeemCode(req.body && req.body.code);
  if (!uid) return res.status(400).json({ code: 'sso_code_invalid', error: 'Sign-in link expired, please try again' });
  // Re-check: the account may have been disabled in the last seconds.
  const user = await users.findById(uid);
  if (!user || !user.is_active) return res.status(403).json({ code: 'account_disabled', error: 'This account is disabled' });
  await users.touchLastLogin(user.id);
  logger.info(`Host login (Google): ${user.username}`);
  return res.json({
    access_token: signToken(user),
    token_type: 'bearer',
    role: user.role,
    username: user.username,
    display_name: user.display_name || '',
  });
}));

/** SP metadata (upload to the Google Admin console, or copy its values). */
router.get('/metadata', (req, res) => {
  const xml = sso.metadataXml();
  if (!xml) return res.status(404).json({ error: 'Set PUBLIC_BASE_URL to publish SAML metadata' });
  res.type('application/samlmetadata+xml').send(xml);
});

/** Admin: values to enter in Google, and what is still missing. */
router.get('/config', requireAuth, requireAdmin, (req, res) => {
  const s = config.sso;
  res.json({
    enabled: s.enabled,
    email_domain: s.emailDomain,
    acs_url: s.acsUrl,
    entity_id: s.spEntityId,
    metadata_url: s.publicBaseUrl ? `${s.publicBaseUrl}/api/auth/saml/metadata` : '',
    name_id_format: 'EMAIL',
    missing: [
      !s.publicBaseUrl && 'PUBLIC_BASE_URL',
      !s.idpSsoUrl && 'SAML_IDP_SSO_URL',
      !s.idpEntityId && 'SAML_IDP_ENTITY_ID',
      !s.idpCert && 'SAML_IDP_CERT',
    ].filter(Boolean),
  });
});

module.exports = router;
