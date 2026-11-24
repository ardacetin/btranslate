'use strict';

const crypto = require('crypto');
const { SAML, ValidateInResponseTo, generateServiceProviderMetadata } = require('@node-saml/node-saml');
const config = require('../config');

/**
 * Google Workspace SAML sign-in for the admin panel (SP-initiated only).
 *
 *   panel ──► GET /api/auth/saml/login ──► Google (AuthnRequest)
 *   Google ──► POST /api/auth/saml/acs (signed SAMLResponse)
 *   server verifies, maps the email to a panel account, then redirects to
 *   /host#sso=<one-time code>; the panel trades the code for its JWT at
 *   POST /api/auth/saml/exchange.
 *
 * What a response must satisfy:
 *   - assertion signed by the configured Google certificate,
 *   - issuer = SAML_IDP_ENTITY_ID, audience = our SP entity ID,
 *   - InResponseTo = a request this server issued in the last 10 minutes
 *     (unsolicited / IdP-initiated responses are refused), never replayed,
 *   - within its validity window (±60 s clock skew).
 * Then the caller checks the email domain and that an active panel account
 * has exactly that email.
 *
 * The JWT never travels in a URL: the redirect carries a random single-use
 * code that expires after 60 seconds, in the URL fragment (never sent to the
 * server, so it is not in access logs either).
 */

const EMAIL_FORMAT = 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress';
const CODE_TTL_MS = 60 * 1000;
const REQUEST_TTL_MS = 10 * 60 * 1000;

let saml = null;

function enabled() {
  return config.sso.enabled;
}

function client() {
  if (!enabled()) return null;
  if (!saml) {
    saml = new SAML({
      entryPoint: config.sso.idpSsoUrl,
      issuer: config.sso.spEntityId,
      callbackUrl: config.sso.acsUrl,
      idpCert: config.sso.idpCert,
      idpIssuer: config.sso.idpEntityId,
      audience: config.sso.spEntityId,
      identifierFormat: EMAIL_FORMAT,
      // Google signs the assertion by default ("Signed response" in the
      // Google app settings additionally signs the envelope; not required).
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: false,
      validateInResponseTo: ValidateInResponseTo.always,
      requestIdExpirationPeriodMs: REQUEST_TTL_MS,
      rejectReplayedAssertions: true,
      acceptedClockSkewMs: 60 * 1000,
      disableRequestedAuthnContext: true,
    });
  }
  return saml;
}

/** Google sign-in URL carrying a fresh AuthnRequest (its ID is remembered). */
async function loginUrl() {
  return client().getAuthorizeUrlAsync('', {});
}

/**
 * Validate a posted SAMLResponse. Resolves to the asserted email (lowercase)
 * or throws when the response is not acceptable.
 */
async function verifyResponse(samlResponse) {
  if (typeof samlResponse !== 'string' || !samlResponse) throw new Error('Missing SAMLResponse');
  const { profile, loggedOut } = await client().validatePostResponseAsync({ SAMLResponse: samlResponse });
  if (loggedOut || !profile) throw new Error('Not a sign-in response');
  const candidate = [profile.nameID, profile.email, profile.mail].find((v) => typeof v === 'string' && v.includes('@'));
  if (!candidate) throw new Error('Response has no email address');
  return candidate.trim().toLowerCase();
}

/** Service-provider metadata for the Google Admin console (works before the IdP is configured). */
function metadataXml() {
  if (!config.sso.publicBaseUrl) return null;
  return generateServiceProviderMetadata({
    issuer: config.sso.spEntityId,
    callbackUrl: config.sso.acsUrl,
    identifierFormat: EMAIL_FORMAT,
    wantAssertionsSigned: true,
  });
}

// ── Single-use login codes ───────────────────────────────────────────────
const codes = new Map(); // code -> { uid, expires }

function issueCode(uid) {
  const code = crypto.randomBytes(32).toString('base64url');
  codes.set(code, { uid, expires: Date.now() + CODE_TTL_MS });
  return code;
}

/** Returns the user id for a valid code and burns it; null otherwise. */
function redeemCode(code) {
  if (typeof code !== 'string') return null;
  const entry = codes.get(code);
  codes.delete(code);
  if (!entry || entry.expires < Date.now()) return null;
  return entry.uid;
}

setInterval(() => {
  const now = Date.now();
  for (const [code, entry] of codes) if (entry.expires < now) codes.delete(code);
}, CODE_TTL_MS).unref();

module.exports = { enabled, loginUrl, verifyResponse, metadataXml, issueCode, redeemCode };
