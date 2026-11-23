-- User management: display name, account activation, token revocation and
-- last-login tracking.
--
-- token_version is embedded in every JWT ("tv" claim). Bumping it (password
-- change/reset) invalidates all tokens issued before, so a changed password
-- logs the account out everywhere. Existing tokens carry no "tv" and are
-- treated as version 0, so nobody is logged out by this migration.
ALTER TABLE users
  ADD COLUMN display_name  VARCHAR(128) NULL AFTER username,
  ADD COLUMN is_active     TINYINT(1) NOT NULL DEFAULT 1 AFTER role,
  ADD COLUMN token_version INT NOT NULL DEFAULT 0 AFTER is_active,
  ADD COLUMN last_login_at DATETIME NULL AFTER token_version;
