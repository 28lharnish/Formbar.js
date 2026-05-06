-- 33_remove_tags.sql
-- Removes the "tags" column from the "users" table, and the class-level "tags" column from the "classroom" table

ALTER TABLE users DROP COLUMN tags;
ALTER TABLE classroom DROP COLUMN tags;