-- 38_add_poll_options_to_poll_history.sql
-- This migration adds the time, auto_end_threshold, and auto_end_timer columns to the poll_history table.

ALTER TABLE poll_history ADD COLUMN "auto_end_timer" INTEGER;
ALTER TABLE poll_history ADD COLUMN "auto_end_threshold" INTEGER;