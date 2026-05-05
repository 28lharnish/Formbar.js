-- 36_remove_app_scopes.sql
-- This migration removes the scopes column from the apps table, as it's no longer needed.

ALTER TABLE apps
DROP COLUMN scopes;