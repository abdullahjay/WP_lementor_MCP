-- Hand-written reverse of 0000_acoustic_vampiro.sql — drizzle-kit does not
-- generate down migrations. Child tables (FK -> sites) first, sites last.
DROP TABLE IF EXISTS "approval_tokens";
DROP TABLE IF EXISTS "credentials";
DROP TABLE IF EXISTS "grants";
DROP TABLE IF EXISTS "idempotency_keys";
DROP TABLE IF EXISTS "ledger_index";
DROP TABLE IF EXISTS "preview_nonces";
DROP TABLE IF EXISTS "sites";
