const { all, columns, exec, mark, rebuild, run, tableExists } = require("./00_helpers");

/**
 * Adds v3 feature tables and converts pool/token storage.
 *
 * @param {import("sqlite3").Database} database
 * @returns {Promise<void>}
 */
async function runMigration(database) {
    const applied = await all(database, "SELECT 1 FROM schema_migrations_v2 WHERE name = ?", ["04_features_and_tokens"]);
    if (applied.length) return;
    await run(database, "BEGIN IMMEDIATE");
    try {
        await exec(
            database,
            `CREATE TABLE IF NOT EXISTS api_keys (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, api_key_hash TEXT NOT NULL UNIQUE, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
             CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_entity ON api_keys (entity_type, entity_id);
            CREATE TABLE IF NOT EXISTS links (id INTEGER NOT NULL UNIQUE, name TEXT NOT NULL, url TEXT NOT NULL, classId INTEGER NOT NULL, PRIMARY KEY (id AUTOINCREMENT));
            CREATE TABLE IF NOT EXISTS app_redirect_uris (id INTEGER PRIMARY KEY AUTOINCREMENT, app_id INTEGER NOT NULL, redirect_uri TEXT NOT NULL, UNIQUE (app_id, redirect_uri));
             CREATE TABLE IF NOT EXISTS apps (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT, owner_user_id INTEGER NOT NULL, share_item_id INTEGER NOT NULL, pool_id INTEGER NOT NULL, client_secret_hash TEXT);
             CREATE TABLE IF NOT EXISTS inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, item_id INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0));
             CREATE TABLE IF NOT EXISTS item_registry (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT, stack_size INTEGER NOT NULL DEFAULT 1 CHECK (stack_size >= 0), image_url TEXT);
             CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL, data TEXT, is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)), created_at TEXT NOT NULL DEFAULT (datetime('now')));
             CREATE TABLE IF NOT EXISTS oauth_grants (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, app_id INTEGER NOT NULL, scopes TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, revoked_at INTEGER, UNIQUE (user_id, app_id));
             CREATE TABLE IF NOT EXISTS user_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, purpose TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, pool_id INTEGER);
             CREATE TABLE IF NOT EXISTS exchanges (id INTEGER PRIMARY KEY AUTOINCREMENT, from_user_id INTEGER, from_id INTEGER, from_type TEXT, offer TEXT, to_user_id INTEGER, to_id INTEGER, to_type TEXT, request TEXT, reason TEXT, status TEXT, failure_reason TEXT, created_at TEXT, updated_at TEXT);
             CREATE TABLE IF NOT EXISTS trades (id INTEGER PRIMARY KEY AUTOINCREMENT, from_user INTEGER NOT NULL, to_user INTEGER NOT NULL, from_source_type TEXT NOT NULL DEFAULT 'inventory', from_pool_id INTEGER, to_source_type TEXT NOT NULL DEFAULT 'inventory', to_pool_id INTEGER, offered_items TEXT, requested_items TEXT, offered_digipogs INTEGER, requested_digipogs INTEGER, status TEXT NOT NULL DEFAULT 'pending', failure_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`
        );

        if (await tableExists(database, "digipog_pools")) {
            const poolColumns = await columns(database, "digipog_pools");
            if (!poolColumns.includes("share_item") || !poolColumns.includes("pin")) {
                await rebuild(
                    database,
                    "digipog_pools",
                    `CREATE TABLE digipog_pools__migration (id INTEGER NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT 'None', amount INTEGER NOT NULL DEFAULT 0, share_item INTEGER DEFAULT NULL, pin TEXT, PRIMARY KEY (id AUTOINCREMENT))`,
                    `INSERT INTO digipog_pools__migration (id, name, description, amount, share_item, pin) SELECT id, name, description, amount, ${poolColumns.includes("share_item") ? "share_item" : "NULL"}, ${poolColumns.includes("pin") ? "pin" : "NULL"} FROM digipog_pools__migration_source`
                );
            }
        } else {
            await exec(
                database,
                `CREATE TABLE digipog_pools (id INTEGER NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT 'None', amount INTEGER NOT NULL DEFAULT 0, share_item INTEGER DEFAULT NULL, pin TEXT, PRIMARY KEY (id AUTOINCREMENT))`
            );
        }

        await run(database, "DROP TABLE IF EXISTS refresh_tokens__migration");
        await exec(
            database,
            `CREATE TABLE refresh_tokens__migration (user_id INTEGER NOT NULL, token_hash TEXT NOT NULL UNIQUE, exp INTEGER NOT NULL, token_type TEXT NOT NULL DEFAULT 'auth');
             CREATE INDEX idx_refresh_tokens_type ON refresh_tokens__migration (token_type);
             CREATE INDEX idx_refresh_tokens_user_type ON refresh_tokens__migration (user_id, token_type)`
        );
        await run(database, "DROP TABLE refresh_tokens");
        await run(database, "ALTER TABLE refresh_tokens__migration RENAME TO refresh_tokens");
        await mark(database, "04_features_and_tokens");
        await run(database, "COMMIT");
    } catch (error) {
        await run(database, "ROLLBACK").catch(() => undefined);
        throw error;
    }
}

module.exports = { run: runMigration };
