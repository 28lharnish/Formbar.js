-- 38_add_poll_options_to_poll_history.sql
-- This migration adds the time, auto_end_threshold, and auto_end_timer columns to the poll_history table.

ALTER TABLE poll_history ADD COLUMN IF NOT EXISTS "auto_end_timer" INTEGER;
ALTER TABLE poll_history ADD COLUMN IF NOT EXISTS "auto_end_threshold" INTEGER;
ALTER TABLE poll_history ADD COLUMN IF NOT EXISTS "blind_until_ended" INTEGER NOT NULL DEFAULT 0 CHECK ("blind_until_ended" IN (0, 1));