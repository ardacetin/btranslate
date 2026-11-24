-- Google Workspace SAML sign-in.
-- `email` links an account to the institutional Google identity (always
-- stored lowercase; unique). Accounts created for Google sign-in only have no
-- password, so password_hash becomes optional — password login refuses those.
ALTER TABLE users
  ADD COLUMN email VARCHAR(255) NULL AFTER display_name,
  ADD UNIQUE KEY uq_users_email (email),
  MODIFY password_hash VARCHAR(255) NULL;
