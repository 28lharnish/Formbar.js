-- 35_add_api_key_table.sql
CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL, -- 'user' or 'app'
    entity_id INTEGER NOT NULL, -- user_id or app_id
    api_key_hash TEXT NOT NULL UNIQUE, -- SHA-256 hash of the API key
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_entity ON api_keys (entity_type, entity_id);