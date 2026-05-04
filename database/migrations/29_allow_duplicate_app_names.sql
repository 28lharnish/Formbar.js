-- 28_allow_duplicate_app_names.sql
-- Rebuilds the apps table without a UNIQUE constraint on name so apps can
-- legitimately share the same display name.

DROP TABLE IF EXISTS apps_new;

CREATE TABLE IF NOT EXISTS apps_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    owner_user_id INTEGER NOT NULL,
    share_item_id INTEGER NOT NULL,
    pool_id INTEGER NOT NULL,
    api_key_hash TEXT NOT NULL UNIQUE,
    api_secret_hash TEXT NOT NULL
);

INSERT INTO apps_new (id, name, description, owner_user_id, share_item_id, pool_id, api_key_hash, api_secret_hash)
SELECT id, name, description, owner_user_id, share_item_id, pool_id, api_key_hash, api_secret_hash
FROM apps;

DROP TABLE apps;
ALTER TABLE apps_new RENAME TO apps;
