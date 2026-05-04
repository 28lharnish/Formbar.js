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

SQL and JS migrations are combined and sorted by filename (source: `database/migrate.js` migration collection). Keep new filenames sequenced with the existing history and do not edit existing migrations once they are in the tree (source: repository rules in `AGENTS.md`).

Current migration history has gaps and duplicate `28_` prefixes. Preserve the current files as history; choose the next clear sequence number for new work.

By default, the migration runner backs up `database/database.db` before running unless `SKIP_BACKUP` is set (source: `database/migrate.js` backup block).

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

- Deleting or regenerating RSA keys invalidates tokens signed with the previous keys.
- `EMAIL_ENABLED=false` changes verification behavior; tests or local flows may pass without email paths being active.
- `TRUST_PROXY` matters for correct IP detection and rate limiting behind nginx or another proxy.
- Updating schema without updating `modules/test-helpers/test-schema.sql` can cause tests to drift from the migrated database.
