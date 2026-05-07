# Formbar.js Onboarding

When to read this: start here on day one, then follow the guide links for the area you will change first.

Formbar.js is a Node.js backend for classroom polling, live classroom state, digipogs, user management, and third-party API/OAuth integrations (source: `services/class-service.js`, `services/poll-service.js`, `services/digipog-service.js`, `services/user-service.js`, `services/auth-service.js`). It exposes versioned REST endpoints under `api/v1/controllers`, realtime behavior through Socket.IO modules under `sockets`, and OpenAPI documentation at `/docs` (source: `app.js:getJSFiles`, `sockets/init.js:initSocketRoutes`, `modules/web-server.js:createServer`).

This repository is backend and realtime focused. The frontend is expected to run separately and is configured with `FRONTEND_URL` in `.env-template` (source: `.env-template`, `modules/config.js:getConfig`).

## First Hour

1. Install dependencies: `npm install`
2. Initialize the local SQLite database: `npm run init-db`
3. Apply migrations if needed: `npm run migrate`
4. Start the server: `npm run dev`
5. Run the full test suite: `npm test`
6. Open API docs: `http://localhost:420/docs`

If startup exits with a missing database message, run `npm run init-db`. The app intentionally refuses to boot without `database/database.db`.

## Reading Order

1. [Project Map](./project-map.md): where code lives and where new code usually belongs.
2. [Runtime Flow](./runtime-flow.md): how startup, HTTP requests, and sockets are wired.
3. [Data and Auth](./data-and-auth.md): SQLite, migrations, tokens, API keys, OIDC, and permissions.
4. [Developer Workflow](./dev-workflow.md): local commands, test layout, and change workflow.
5. [Architecture Diagrams](./architecture.md): Mermaid diagrams for architecture, auth, requests, sockets, database relationships, and major dependencies.
6. [Codebase Map](./codebase-map.md): every directory and file in one chart, with a complete file inventory.
7. [Feature State](./feature-state.md): current product areas, deprecated compatibility paths, and known partial work.

## Core Entry Points

- `app.js`: process startup, middleware order, dynamic route mounting, legacy API compatibility, socket initialization, and server listen (source: `app.js:getJSFiles`, `app.js:attachLegacyApiDeprecationHeaders`, `http.listen` block).
- `modules/web-server.js`: Express app, HTTP server, Socket.IO server, Swagger/OpenAPI wiring (source: `modules/web-server.js:createServer`).
- `modules/config.js`: environment settings, generated RSA keypair, rate-limit config, and `.env` bootstrapping (source: `modules/config.js:getConfig`, `generateKeyPair`).
- `database/init.js`: local DB bootstrap from `database/init.sql` (source: `database/init.js:initializeDatabase`).
- `database/migrate.js`: SQL and JS migration runner (source: `database/migrate.js:executeMigration`, migration collection).
- `sockets/init.js`: Socket.IO middleware and event module loading (source: `sockets/init.js:initSocketRoutes`).

## New Contributor Rules Of Thumb

- Put behavior in `services/**` when it is shared by HTTP controllers, socket handlers, or multiple features.
- Keep HTTP-specific request/response code in `api/v1/controllers/**`.
- Keep socket event wiring in `sockets/**`, and reuse services instead of duplicating domain logic.
- Add schema changes as new migrations under `database/migrations/**`; do not edit `database/init.sql` or existing migrations.
- Prefer broad feature or endpoint tests over one-off regression files when a nearby suite can cover the behavior.

## Common Pitfalls

These are the mistakes new contributors most often make. Read this before you open a PR.

### Database calls inside loops

**Do not call `dbGet`, `dbRun`, or `dbGetAll` inside a `for` loop, `forEach`, or `map`.**

```js
// BAD — one query per user, N round-trips to SQLite
for (const userId of userIds) {
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    results.push(user);
}

// GOOD — one query, all rows returned together
const placeholders = userIds.map(() => '?').join(', ');
const users = await dbGetAll(
    `SELECT * FROM users WHERE id IN (${placeholders})`,
    userIds
);
```

This is the single most common source of performance bugs in this codebase. SQLite is fast for single batched queries but serial per-row queries in a loop add up quickly, especially inside socket handlers that can fire frequently.

### Writing domain logic in controllers or socket handlers

Controllers (`api/v1/controllers/**`) and socket handlers (`sockets/**`) should validate input, call a service, and return a response. If you find yourself writing database queries or business rules directly in a controller or socket handler, stop and move that logic into `services/**`. The same logic almost always needs to be shared between the HTTP and real-time paths.

### Confusing in-memory stores with the database

`stores/**` (e.g., `class-state-store.js`, `poll-runtime-store.js`) are **in-memory only**. They are reset every time the server restarts. Anything that must survive a restart — user data, poll history, digipog balances — must be persisted through `modules/database.js`. Do not add data to a store when you mean to persist it.

### Editing `database/init.sql` or existing migrations

`database/init.sql` and any existing file under `database/migrations/` must not be modified. If the schema needs to change, add a **new** migration file with the next sequence number. Editing history breaks any environment that has already applied those migrations.

### RSA key regeneration invalidates all active tokens

Deleting or regenerating `public-key.pem` / `private-key.pem` immediately invalidates every active access token and refresh token signed with the old key. All logged-in users will be forced to re-authenticate. Only do this intentionally.

### Expanding legacy API aliases

`app.js` keeps backward-compatible `/api/*` paths alive for existing clients and advertises a sunset date of September 1, 2026. Do not add new behavior under the legacy paths. New endpoints must use `/api/v1`.

### Test schema drift after migrations

`modules/test-helpers/test-schema.sql` is the schema the test suite runs against. When you add a migration that changes table structure, you must also update `test-schema.sql` to match, or tests will silently run against a stale schema.

### Socket modules with the wrong export shape

`sockets/init.js` expects every event module to export `run(socket, socketUpdates)`. A module that exports nothing, or exports a different function name, will be loaded silently but its events will never register. If a socket event does nothing, check the export first.

### Missing `TRUST_PROXY` behind a reverse proxy

If the server runs behind nginx or another proxy, `TRUST_PROXY` must be set in `.env`. Without it, Express sees the proxy's IP address for every request, which collapses all rate-limiting onto a single "user" and breaks IP-based access control.

### `EMAIL_ENABLED=false` masks verification paths

The default local config has email disabled. User flows that depend on email verification (registration confirmation, password reset) will behave differently than in production. Always test email-dependent paths with `EMAIL_ENABLED=true` and a real or fake SMTP target before shipping.
