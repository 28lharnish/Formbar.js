-- 30_add_app_redirect_uris.sql
-- Registered OAuth redirect URIs for third-party apps.

CREATE TABLE IF NOT EXISTS app_redirect_uris (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL,
    redirect_uri TEXT NOT NULL,
    UNIQUE (app_id, redirect_uri)
);

CREATE INDEX IF NOT EXISTS idx_app_redirect_uris_app ON app_redirect_uris (app_id);
