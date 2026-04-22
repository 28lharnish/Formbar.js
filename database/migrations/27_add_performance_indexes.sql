-- 27_add_performance_indexes.sql
-- Adds non-breaking performance indexes to common lookup and join columns.

-- Classroom lookups
CREATE INDEX IF NOT EXISTS idx_classroom_owner ON classroom (owner);
CREATE INDEX IF NOT EXISTS idx_classroom_key ON classroom (key);

-- Class membership lookups (by class, by student, and exact pair)
CREATE INDEX IF NOT EXISTS idx_classusers_class_student ON classusers (classId, studentId);
CREATE INDEX IF NOT EXISTS idx_classusers_student_class ON classusers (studentId, classId);

-- Links per class
CREATE INDEX IF NOT EXISTS idx_links_class_id ON links (classId);

-- Custom poll ownership lookups
CREATE INDEX IF NOT EXISTS idx_custom_polls_owner ON custom_polls (owner);

-- Digipog pool membership lookups and owner checks
CREATE INDEX IF NOT EXISTS idx_digipog_pool_users_user_pool ON digipog_pool_users (user_id, pool_id);
CREATE INDEX IF NOT EXISTS idx_digipog_pool_users_pool_owner ON digipog_pool_users (pool_id, owner);

-- User role lookups by user/class and role/class
CREATE INDEX IF NOT EXISTS idx_user_roles_user_class ON user_roles (userId, classId);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_class ON user_roles (roleId, classId);

-- Transaction history and account-scoped transaction queries
CREATE INDEX IF NOT EXISTS idx_transactions_from_account_date ON transactions (from_type, from_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_to_account_date ON transactions (to_type, to_id, date DESC);

-- Notification reads by user and unread state
DROP INDEX IF EXISTS idx_notifications_user_id;
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications (user_id, is_read);

-- Trade inbox/outbox and status lookups
CREATE INDEX IF NOT EXISTS idx_trades_from_user ON trades (from_user);
CREATE INDEX IF NOT EXISTS idx_trades_to_user ON trades (to_user);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades (status);