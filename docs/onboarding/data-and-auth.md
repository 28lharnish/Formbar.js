# Data And Auth

Read this before changing database schema, migrations, login, tokens, API keys, OIDC, roles, scopes, or permission checks.

Back to: [Onboarding Home](./README.md)

## Two Kinds Of State

Formbar.js uses both SQLite and in-memory stores.

| State Type | Where It Lives | Survives Restart? | Examples |
|---|---|---|---|
| Durable state | SQLite through `modules/database.js` | Yes | Users, classes, roles, refresh tokens, poll history, digipogs, inventory, notifications, apps |
| Runtime state | `stores/**` | No | Active class state, connected sockets, active poll state, class-code cache, API-key cache |

If losing the data on restart would be a bug, do not put it only in `stores/**`.

## Database Files

| File Or Folder | Purpose |
|---|---|
| `database/init.sql` | Base schema for a brand-new database |
| `database/init.js` | Creates `database/database.db` from `init.sql`, then runs migrations |
| `database/migrate.js` | Runs all SQL and JS migrations |
| `database/migrations/*.sql` | SQL migration history |
| `database/migrations/JSMigrations/*.js` | JavaScript migration history |
| `modules/database.js` | Shared database helpers: `dbGet`, `dbRun`, `dbGetAll` |
| `modules/test-helpers/test-schema.sql` | Schema used by tests |

Do not edit `database/init.sql` or old migrations. Add a new migration instead.

## Local Database Lifecycle

For a new local database:

```bash
npm run init-db
```

That command:

1. Refuses to overwrite an existing `database/database.db`.
2. Creates the database from `database/init.sql`.
3. Sets `SKIP_BACKUP=true`.
4. Runs `database/migrate.js`.

For an existing local database:

```bash
npm run migrate
```

`npm run migrate` backs up `database/database.db` before running unless `SKIP_BACKUP` is set.

## How Migrations Work

Important: this migration runner has no tracking table.

That means every time `npm run migrate` runs, it attempts every migration file again from the beginning.

Every migration must therefore be idempotent, which means it must be safe to run more than once.

### SQL Migrations

Use SQLite guards when SQLite supports them:

```sql
CREATE TABLE IF NOT EXISTS example_table (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_example_name ON example_table (name);

DROP INDEX IF EXISTS idx_old_example;
DROP TABLE IF EXISTS old_example_table;
```

SQLite does not support `IF NOT EXISTS` for `ALTER TABLE ADD COLUMN`. In this repo, it is acceptable to write:

```sql
ALTER TABLE users ADD COLUMN display_name TEXT;
```

On the second run, SQLite throws a duplicate-column error. The SQL migration runner catches SQL file errors, rolls back that file, prints a warning, and continues. That pattern is already part of this repo's migration style.

### JS Migrations

JS migrations export `run(database)`:

```js
module.exports = {
    async run(database) {
        // migration work
    },
};
```

Preferred pattern: check before changing schema or data.

```js
const { dbGetAll, dbRun } = require("@modules/database");

module.exports = {
    async run(database) {
        const columns = await dbGetAll("PRAGMA table_info(users)", [], database);
        const hasDisplayName = columns.some((column) => column.name === "display_name");

        if (!hasDisplayName) {
            await dbRun("ALTER TABLE users ADD COLUMN display_name TEXT", [], database);
        }
    },
};
```

For destructive one-time transformations, check whether the old shape still exists. If it does not, throw:

```js
throw new Error("ALREADY_DONE");
```

`database/migrate.js` treats exactly `"ALREADY_DONE"` as a graceful skip for JS migrations.

## Schema Change Checklist

When changing schema or persisted data:

1. Add a new migration file. Do not edit history.
2. Make the migration idempotent.
3. Update service queries.
4. Update `modules/test-helpers/test-schema.sql`.
5. Add or update tests.
6. Run the relevant tests.
7. Run `npm run migrate` on a local database to verify the migration path.

## Database Helper Rules

Use `modules/database.js` helpers:

| Helper | Use For |
|---|---|
| `dbGet` | A query that returns one row |
| `dbGetAll` | A query that returns many rows |
| `dbRun` | `INSERT`, `UPDATE`, `DELETE`, or other statements |

Avoid database calls inside loops. Prefer one batched query:

```js
const placeholders = ids.map(() => "?").join(", ");
const rows = await dbGetAll(
    `SELECT * FROM users WHERE id IN (${placeholders})`,
    ids
);
```

## Auth Paths

Formbar.js supports several authentication paths:

| Auth Path | Main Code |
|---|---|
| Email/password register and login | `services/auth-service.js`, `api/v1/controllers/auth/**` |
| Guest login | `services/auth-service.js`, `api/v1/controllers/auth/guest.js` |
| Access token refresh | `services/auth-service.js`, `api/v1/controllers/auth/refresh.js` |
| API key auth | `services/api-key-service.js`, `middleware/authentication.js` |
| OIDC login with configured providers | `modules/oidc.js`, `api/v1/controllers/auth/oidc/**` |
| OAuth app authorization/token flow | `services/auth-service.js`, `api/v1/controllers/oauth/**` |

Most protected HTTP routes use `isAuthenticated` from `middleware/authentication.js`.

## Token Behavior

- Access tokens are RS256 JWTs and currently expire after 15 minutes.
- App login refresh tokens are RS256 JWTs and currently expire after 30 days.
- Stored refresh tokens are hashed before they are saved.
- OAuth authorization codes are single-use.
- Used authorization-code hashes are stored so a code cannot be reused.
- RSA keys come from `public-key.pem` and `private-key.pem`.

Deleting or regenerating the RSA key files invalidates existing tokens. Only do that intentionally.

Expired refresh-token and authorization-code cleanup code exists in `middleware/authentication.js`, but the interval that would run it during startup is currently commented out in `app.js`. See [Feature State](./feature-state.md).

## HTTP Auth And Authorization

`middleware/authentication.js` provides:

| Function | Purpose |
|---|---|
| `isAuthenticated` | Accepts an API key or bearer token and sets `req.user` |
| `isVerified` | Requires verified email when `EMAIL_ENABLED=true`; guests bypass this |
| `isIPBanned` | Enforces IP allow/deny rules |

`middleware/permission-check.js` provides:

| Function | Purpose |
|---|---|
| `hasScope(...)` | Checks a global scope |
| `hasClassScope(...)` | Checks a class-level scope |
| `isClassMember(...)` | Checks class membership when used by a route |

New authorization logic should prefer scopes over numeric permission levels. Numeric levels still exist for compatibility and summaries.

## Roles And Scopes

Scopes are named permissions. Roles are collections of scopes.

Related files:

| File | Purpose |
|---|---|
| `modules/scopes.js` | Scope constants |
| `modules/permissions.js` | Scope-to-permission summaries |
| `modules/scope-resolver.js` | Computes effective scopes for a user |
| `modules/roles.js` | Role helpers |
| `modules/role-reference.js` | Role definitions/reference data |
| `services/role-service.js` | Persisted role and class-role behavior |

When adding a new permission:

1. Add or reuse a scope constant.
2. Add service behavior that enforces the rule.
3. Add HTTP and/or socket checks.
4. Update role defaults if the scope should belong to built-in roles.
5. Add tests for allowed and denied users.

## Socket Auth

Socket auth lives under `sockets/middleware/**`.

Socket connections run through:

1. Shared Express session middleware.
2. IP allow/deny check.
3. Socket auth/API middleware.
4. Socket rate limiting and inactivity tracking.
5. Event handlers.

Keep socket authorization aligned with matching HTTP behavior. If a teacher cannot do something through HTTP, they should not be able to do it through a socket event either.

## Environment Settings That Affect Auth

| Setting | Effect |
|---|---|
| `EMAIL_ENABLED` | Enables email verification requirements and email-dependent flows |
| `FRONTEND_URL` | Used by flows that need frontend links or redirects |
| `GOOGLE_OIDC_*` | Enables Google OIDC login when configured |
| `MICROSOFT_OIDC_*` | Enables Microsoft OIDC login when configured |
| `WHITELIST_ENABLED` | Enables IP whitelist enforcement |
| `BLACKLIST_ENABLED` | Enables IP blacklist enforcement |
| `TRUST_PROXY` | Tells Express how to read client IPs behind a proxy |
| `RATE_LIMIT_WINDOW_SECONDS` | Controls rate-limit window length |
| `RATE_LIMIT_MULTIPLIER` | Scales rate limits |

## Common Pitfalls

- Do not persist important data only in `stores/**`.
- Do not edit `database/init.sql` or old migrations.
- Do not forget `modules/test-helpers/test-schema.sql` after schema changes.
- Do not regenerate RSA keys casually.
- Do not assume email flows were tested if `EMAIL_ENABLED=false`.
- Do not add database calls inside loops.
- Do not add a socket permission without checking the matching HTTP permission.
