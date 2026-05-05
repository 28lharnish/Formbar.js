-- 35_remove_app_api_key.sql
-- This migration removes the API key column from the apps table, as it's no longer needed.

ALTER TABLE apps
DROP COLUMN api_key_hash;
DROP COLUMN api_secret_hash;