-- 35_add_oauth_grants_and_refresh_metadata.sql
-- Stores per-user OAuth app grants and the app/scope metadata
-- TODO REFRESH TOKEN NEED DONE

CREATE TABLE IF NOT EXISTS oauth_grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    app_id INTEGER NOT NULL,
    scopes TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    revoked_at INTEGER,
    UNIQUE (user_id, app_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_grants_user_app ON oauth_grants (user_id, app_id);
CREATE INDEX IF NOT EXISTS idx_oauth_grants_app ON oauth_grants (app_id);