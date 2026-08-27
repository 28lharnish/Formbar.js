-- 36_add_pog_meter.sql
-- This migration adds a pog_meter field to the users table to track the user's pog meter level.

ALTER TABLE users ADD COLUMN pog_meter INTEGER NOT NULL DEFAULT 0 CHECK (pog_meter >= 0);