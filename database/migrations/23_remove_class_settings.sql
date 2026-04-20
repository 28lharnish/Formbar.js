-- 23_remove_class_settings.sql
-- This migration removes the settings column from the classroom table.

ALTER TABLE classroom DROP COLUMN settings;