-- 31_remove_tags.sql
-- Removes the "tags" column from the "students" table, and the class-level "tags" column from the "classes" table

ALTER TABLE students DROP COLUMN tags;
ALTER TABLE classes DROP COLUMN tags;