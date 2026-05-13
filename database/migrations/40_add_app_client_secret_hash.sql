-- 40_add_app_client_secret_hash.sql
-- Store OAuth client secrets separately from app API keys.

ALTER TABLE apps ADD COLUMN client_secret_hash TEXT;
