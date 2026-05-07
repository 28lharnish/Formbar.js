# Data And Auth

When to read this: before changing persistence, migrations, login, tokens, API keys, OIDC, roles, scopes, or permissions.

Back to: [Onboarding Home](./README.md)

## Persistence Model

Formbar.js uses SQLite for durable state and in-memory stores for live runtime state (source: `modules/database.js:getDatabase`, store imports in `services/classroom-service.js`, `services/socket-updates-service.js`, and `services/poll-service.js`).

- Durable state: users, roles, classes, class membership, refresh tokens, digipog transactions, pools, inventory/items, notifications, apps, IP access rules, and related audit/history data (source: `database/init.sql`, `database/migrations/**`, service queries under `services/**`).
- Runtime state: active class/session state, socket activity, poll runtime state, class code cache, API key cache, and other live caches under `stores/**` (source: `stores/class-state-store.js`, `stores/socket-state-store.js`, `stores/poll-runtime-store.js`, `stores/class-code-cache-store.js`, `stores/api-key-cache-store.js`).

Do not store anything only in memory if it must survive restart.

## Database Initialization

`npm run init-db` runs `database/init.js` (source: `package.json:scripts.init-db`).

That script:

1. Refuses to overwrite an existing `database/database.db` (source: `database/init.js:initializeDatabase`).
2. Creates the SQLite database from `database/init.sql` (source: `database/init.js:initializeDatabase`).
3. Sets `SKIP_BACKUP=true` (source: `database/init.js:initializeDatabase`).
4. Runs `database/migrate.js` (source: `database/init.js:initializeDatabase`).

Repository rules prohibit editing `database/init.sql`. If data shape or schema behavior needs to change, add a new migration.

## Migrations

`npm run migrate` runs `database/migrate.js` (source: `package.json:scripts.migrate`).

Migration files are collected from:

- `database/migrations/*.sql`
- `database/migrations/JSMigrations/*.js`

SQL and JS migrations are combined and sorted by filename (source: `database/migrate.js` migration collection). Keep new filenames sequenced with the existing history and do not edit existing migrations once they are in the tree.

Current migration history has gaps and duplicate `28_` prefixes. Preserve the current files as history; choose the next clear sequence number for new work.

By default, the migration runner backs up `database/database.db` before running unless `SKIP_BACKUP` is set (source: `database/migrate.js` backup block).

## Writing Idempotent Migrations

**The migration runner has no tracking table.** It re-runs every migration file from the beginning every time `npm run migrate` is called. This means every migration must be safe to execute on a database where it has already been applied.

There are two acceptable approaches: make the migration truly safe to run multiple times, or make it fail loudly in a way the runner recognises as "already done".

### SQL migrations

The runner wraps each SQL file in `BEGIN TRANSACTION` / `COMMIT`. If any statement in the file errors, the runner rolls back, prints a warning, and **continues to the next migration** — it does not halt. This means a SQL migration that errors on a second run is treated as already applied (source: `database/migrate.js:executeSQLMigration`).

**Use `IF NOT EXISTS` / `IF EXISTS` guards whenever SQLite supports them — this is the preferred style:**

```sql
-- Tables
CREATE TABLE IF NOT EXISTS my_table ( ... );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_my_table_col ON my_table (col);
CREATE UNIQUE INDEX IF NOT EXISTS idx_my_table_col ON my_table (col);

-- Dropping tables
DROP TABLE IF EXISTS old_table;

-- Dropping indexes
DROP INDEX IF EXISTS idx_old;
```

**`ALTER TABLE ADD COLUMN` has no `IF NOT EXISTS` in SQLite.** Write it without a guard and let the runner catch the duplicate-column error on a second run:

```sql
-- Safe: errors if column already exists; runner handles the error and continues
ALTER TABLE users ADD COLUMN display_name TEXT;
```

**`ALTER TABLE DROP COLUMN` also has no `IF EXISTS`.** Write it without a guard for the same reason.

**The table-swap pattern** (create temp → copy → drop old → rename) is the standard way to change column types or constraints in SQLite. The guard belongs at the very top — make the first `CREATE TABLE` use `IF NOT EXISTS` so subsequent runs fail immediately on an already-renamed table and the runner moves on:

```sql
-- Migration errors on second run because my_table already exists (old_table is gone)
-- and temp_table creation also fails — both are handled by the runner.
CREATE TABLE IF NOT EXISTS temp_table ( ... );
INSERT INTO temp_table SELECT ... FROM old_table;
DROP TABLE old_table;
ALTER TABLE temp_table RENAME TO my_table;
```

### JS migrations

JS migrations are called as `migrationModule.run(database)`. Two patterns are in use:

**Pattern 1 — truly idempotent (preferred for DDL and data seeding).**
Use `IF NOT EXISTS`, `INSERT OR IGNORE`, and `PRAGMA table_info()` guards throughout so the migration produces no side effects when run on an already-migrated database (source: `database/migrations/JSMigrations/23_add_roles_and_scopes.js`):

```js
module.exports = {
    async run(database) {
        await dbRun(`CREATE TABLE IF NOT EXISTS my_table ( ... )`, [], database);

        // Check before altering
        const cols = await dbGetAll('PRAGMA table_info(my_table)', [], database);
        if (!cols.some(c => c.name === 'new_col')) {
            await dbRun(`ALTER TABLE my_table ADD COLUMN new_col TEXT`, [], database);
        }

        // Seed data without duplicating rows
        await dbRun(`INSERT OR IGNORE INTO my_table (id, name) VALUES (1, 'default')`, [], database);
    },
};
```

**Pattern 2 — state check + `ALREADY_DONE`.**
When a migration is inherently destructive (e.g., the table-swap pattern or one-time data transformation), check whether it has already been applied and throw `new Error("ALREADY_DONE")` if so. The runner catches this specific message and continues (source: `database/migrate.js:executeJSMigration`, `database/migrations/JSMigrations/14_restructure_transactions.js`):

```js
module.exports = {
    async run(database) {
        // Check for the old schema shape that this migration is supposed to transform
        const cols = await dbGetAll('PRAGMA table_info(transactions)', [], database);
        const hasLegacyColumn = cols.some(c => c.name === 'from_user');
        if (!hasLegacyColumn) {
            throw new Error('ALREADY_DONE');
        }

        // ... perform the migration ...
    },
};
```

Only `"ALREADY_DONE"` is treated as a graceful skip. Any other thrown error is logged as a real failure and halts the runner (source: `database/migrate.js:executeJSMigration`).

## Auth Model

Core auth behavior lives in `services/auth-service.js`.

Supported authentication paths:

- Email/password registration and login (source: `services/auth-service.js:register`, `login`).
- Guest login with short-lived access token (source: `services/auth-service.js:loginAsGuest`).
- Refresh-token rotation for app login (source: `services/auth-service.js:refreshLogin`).
- API key authentication for programmatic access (source: `services/api-key-service.js:resolveAPIKey`, `middleware/authentication.js:isAuthenticated`).
- OIDC login providers, currently configured by Google and Microsoft env values (source: `modules/oidc.js:initializeAvailableProviders`, `.env-template`).
- OAuth 2.0 app authorization, token exchange, refresh, and revoke flows (source: `services/auth-service.js:generateAuthorizationCode`, `exchangeAuthorizationCodeForToken`, `exchangeRefreshTokenForAccessToken`, `revokeOAuthToken`).

JWTs are signed with RSA keys loaded by `modules/config.js`. If `public-key.pem` or `private-key.pem` is missing, config generation creates replacements (source: `modules/config.js:getConfig`, `generateKeyPair`; `services/auth-service.js:generateAuthTokens`).

## Token Behavior

- Access tokens are RS256 JWTs with a 15 minute expiry (source: `services/auth-service.js:generateAuthTokens`).
- App login refresh tokens are RS256 JWTs with a 30 day expiry (source: `services/auth-service.js:generateRefreshToken`).
- OAuth refresh tokens are persisted and rotated (source: `services/auth-service.js:exchangeAuthorizationCodeForToken`, `exchangeRefreshTokenForAccessToken`).
- Stored refresh tokens are hashed with SHA-256 in `refresh_tokens`; raw token values are not stored (source: `services/auth-service.js:issueAuthTokens`, `refreshLogin`, `exchangeAuthorizationCodeForToken`).
- Authorization codes are single-use, with used-code hashes stored in `used_authorization_codes` (source: `services/auth-service.js:exchangeAuthorizationCodeForToken`).

There is cleanup code for expired refresh tokens and authorization codes in `middleware/authentication.js`, but the scheduled cleanup block in `app.js` is currently commented out (source: `middleware/authentication.js:cleanRefreshTokens`, commented block in `app.js`). See [Feature State](./feature-state.md).

## HTTP Authentication And Authorization

`middleware/authentication.js` provides:

- `isAuthenticated`: accepts API key auth or bearer access tokens and hydrates `req.user` (source: `middleware/authentication.js:isAuthenticated`).
- `isVerified`: enforces email verification when `EMAIL_ENABLED=true`; guests bypass verification (source: `middleware/authentication.js:isVerified`, `modules/config.js:getConfig`).
- `isIPBanned`: checks the refreshed in-memory IP allow/deny cache (source: `middleware/authentication.js:isIPBanned`, `refreshIPAccessCache`).

Permission checks live in `middleware/permission-check.js` and related modules:

- `modules/scopes.js`: scope constants.
- `modules/permissions.js`: scope-to-permission-level computation.
- `modules/scope-resolver.js`: effective scope resolution.
- `modules/roles.js`, `modules/role-reference.js`, `services/role-service.js`: global/class role definitions and persistence.

Use scope checks for new route authorization. Numeric permission levels still exist for compatibility and computed summaries, but scopes are the more expressive model.

## Socket Authentication

Socket auth lives under `sockets/middleware/**` (source: `sockets/middleware/authentication.js:run`, `sockets/middleware/api.js:run`).

Socket middleware handles API socket behavior, authenticated user setup, inactivity tracking, and socket-side rate limiting. Keep permission decisions aligned with HTTP behavior by reusing services and shared permission helpers.

## Common Pitfalls

- Deleting or regenerating RSA keys immediately invalidates every token signed with the old keys — all users are logged out. Do this only intentionally.
- `EMAIL_ENABLED=false` (the default for local development) silently bypasses email verification flows. Always test registration, password reset, and PIN reset with `EMAIL_ENABLED=true` against a real or fake SMTP target before shipping.
- `TRUST_PROXY` must be set when running behind nginx or another reverse proxy. Without it, Express collapses all rate-limiting onto the proxy's IP and breaks IP-based access control.
- Editing `database/init.sql` or existing migration files breaks any environment that has already applied them. Always add a new migration file instead.
- Updating schema without also updating `modules/test-helpers/test-schema.sql` causes the test suite to run against a stale schema.
- Do not issue database queries in a loop. Use a single batched `IN (...)` query instead. See [Common Pitfalls](./README.md#common-pitfalls) for an example.
- Do not store state only in `stores/**` if it must survive a server restart. In-memory stores reset on every process start.
