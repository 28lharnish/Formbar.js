-- 24_add_role_order.sql
-- This migration adds a role_order column to the role table.
ALTER TABLE class_roles ADD COLUMN orderIndex INTEGER;

-- Set default orderIndex based on built-in role names instead of assumed IDs.
UPDATE class_roles
SET orderIndex = CASE (
    SELECT name
    FROM roles
    WHERE roles.id = class_roles.roleId
)
    WHEN 'Manager' THEN 0
    WHEN 'Teacher' THEN 1
    WHEN 'Mod' THEN 2
    WHEN 'Student' THEN 3
    WHEN 'Guest' THEN 4
    ELSE NULL
END;
