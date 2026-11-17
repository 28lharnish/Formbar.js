const { all, exec, mark, run } = require("./00_helpers");

/**
 * Adds indexes and validates the common v3 schema.
 *
 * @param {import("sqlite3").Database} database
 * @returns {Promise<void>}
 */
async function runMigration(database) {
    const applied = await all(database, "SELECT 1 FROM schema_migrations_v2 WHERE name = ?", ["05_finalize_v3"]);
    if (applied.length) return;
    await exec(
        database,
        `CREATE INDEX IF NOT EXISTS idx_classroom_owner ON classroom (owner);
         CREATE INDEX IF NOT EXISTS idx_classroom_key ON classroom (key);
         CREATE INDEX IF NOT EXISTS idx_classusers_class_student ON classusers (classId, studentId);
         CREATE INDEX IF NOT EXISTS idx_classusers_student_class ON classusers (studentId, classId);
         CREATE INDEX IF NOT EXISTS idx_links_class_id ON links (classId);
         CREATE INDEX IF NOT EXISTS idx_custom_polls_owner ON custom_polls (owner);
         CREATE INDEX IF NOT EXISTS idx_user_roles_user_class ON user_roles (userId, classId);
         CREATE INDEX IF NOT EXISTS idx_user_roles_role_class ON user_roles (roleId, classId);
         CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications (user_id, is_read);
         CREATE INDEX IF NOT EXISTS idx_oauth_grants_user_app ON oauth_grants (user_id, app_id);
         CREATE INDEX IF NOT EXISTS idx_oauth_grants_app ON oauth_grants (app_id);
         CREATE INDEX IF NOT EXISTS idx_user_tokens_user_purpose ON user_tokens (user_id, purpose);
         CREATE INDEX IF NOT EXISTS idx_user_tokens_purpose_hash ON user_tokens (purpose, token_hash);
         CREATE INDEX IF NOT EXISTS idx_user_tokens_expires ON user_tokens (expires_at);
         CREATE INDEX IF NOT EXISTS idx_transactions_from_account_date ON transactions (from_type, from_id, date DESC);
         CREATE INDEX IF NOT EXISTS idx_transactions_to_account_date ON transactions (to_type, to_id, date DESC);
         CREATE INDEX IF NOT EXISTS idx_trades_from_user ON trades (from_user);
         CREATE INDEX IF NOT EXISTS idx_trades_to_user ON trades (to_user);
         CREATE INDEX IF NOT EXISTS idx_trades_status ON trades (status)`
    );
    const required = ["users", "roles", "class_roles", "user_roles", "poll_history", "poll_answers", "transactions", "refresh_tokens"];
    const rows = await all(
        database,
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${required.map(() => "?").join(",")})`,
        required
    );
    if (rows.length !== required.length) throw new Error("v3 schema validation failed");
    await mark(database, "05_finalize_v3");
}

module.exports = { run: runMigration };
