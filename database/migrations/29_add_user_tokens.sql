-- 29_add_user_tokens.sql
-- Purpose-bound, expiring, single-use account tokens for password resets,
-- PIN resets, and email verification.

CREATE TABLE IF NOT EXISTS user_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    purpose TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_user_tokens_user_purpose ON user_tokens (user_id, purpose);
CREATE INDEX IF NOT EXISTS idx_user_tokens_purpose_hash ON user_tokens (purpose, token_hash);
CREATE INDEX IF NOT EXISTS idx_user_tokens_expires ON user_tokens (expires_at);
