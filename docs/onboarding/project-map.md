# Project Map

When to read this: before making your first code change or looking for the owner of a behavior.

Back to: [Onboarding Home](./README.md)

## Top-Level Layout

- `api/`: versioned HTTP API modules. The current public API is mounted from `api/v1/controllers` (source: `app.js:getJSFiles`, route mounting loop).
- `services/`: domain and business logic used by controllers, sockets, tests, and startup bootstrap code (source: imports in `api/v1/controllers/**`, `sockets/**`, and `app.js`).
- `sockets/`: Socket.IO middleware and event handlers for realtime classroom behavior (source: `sockets/init.js:initSocketRoutes`).
- `middleware/`: Express middleware for request logging, rate limiting, authentication, permission checks, JSON parsing, and errors (source: `app.js` middleware setup, `middleware/authentication.js`, `middleware/permission-check.js`).
- `modules/`: shared infrastructure such as config, database helpers, crypto, logging, permissions, roles, OIDC, proxy trust, and utilities (source: `package.json:_moduleAliases`, imports under `services/**`).
- `stores/`: in-memory state and caches used at runtime (source: `services/classroom-service.js`, `services/socket-updates-service.js`, `services/poll-service.js`).
- `database/`: SQLite initialization, migration runner, seed/import data, and migration files (source: `database/init.js:initializeDatabase`, `database/migrate.js:executeMigration`).
- `errors/`: typed application error classes consumed by middleware and controllers (source: `middleware/error-handler.js`, imports from `@errors/**`).
- `email-templates/`: Handlebars templates for account, password, and PIN emails (source: `modules/mail.js`, `services/user-service.js`).
- `docs/components/schemas/`: OpenAPI schema components used by Swagger generation (source: `modules/web-server.js:createServer` `apis` option).
- `reference/`: source material for these onboarding docs, including previous drafts and Cursor planning notes.

## Dependency Shape

Prefer this flow:

```text
controllers/sockets -> services -> modules/stores/database
```

Controllers and sockets should stay thin. They should validate request shape, call services, and translate service results into HTTP responses or socket events. Shared behavior should move down into services so HTTP and realtime code paths stay aligned.

## Where To Add Code

- New REST endpoint: add a module under `api/v1/controllers/**`, then place shared behavior in `services/**`.
- New socket event: add or update a module under `sockets/**`; route domain work through a service.
- New schema/table/column behavior: add a new migration under `database/migrations/**` and update the affected service queries.
- New shared helper: place it under `modules/**` when more than one area needs it.
- New runtime cache or live state: place it under `stores/**` when it must not be persisted directly.
- New OpenAPI model: add or update YAML under `docs/components/schemas/**` and JSDoc annotations in controllers.

## API Controller Layout

`app.js` recursively loads `.js` files under `api/<version>/controllers`, skipping tests (source: `app.js:getJSFiles`). Current route groups include:

- Auth: register, login, refresh, guest login, OIDC providers/callbacks (source: `api/v1/controllers/auth/**`).
- OAuth: authorize, token exchange, refresh, revoke (source: `api/v1/controllers/oauth/**`).
- Users: profile, classes, scopes, permissions, verification, password reset, PIN reset/verify, API key regeneration, ban/unban, delete (source: `api/v1/controllers/user/**`).
- Classes: create, get, start/end session, active state, settings, enroll/join/leave/unenroll/kick/ban, student list, code regeneration (source: `api/v1/controllers/class/**`, excluding nested tool folders).
- Class tools: polls, breaks, help requests, timers, links, and class roles (source: `api/v1/controllers/class/polls/**`, `break/**`, `help/**`, `timer/**`, `links/**`, `roles/**`).
- Digipogs and pools: transfers, awards, pool membership, payout, user pool data (source: `api/v1/controllers/digipogs/**`, `api/v1/controllers/pools/**`, `api/v1/controllers/user/pools.js`).
- System/admin: config, certs, logs, IP access management, manager dashboard data, notifications, app registration, API permission checks (source: `api/v1/controllers/config.js`, `certs.js`, `logs.js`, `ip.js`, `manager/manager.js`, `notifications/**`, `apps/register-app.js`, `api-permission-check.js`).

`api/v1/controllers/controller-template.js` is a commented example only; it is not a live route (source: `api/v1/controllers/controller-template.js`).

## Socket Layout

`sockets/init.js` loads middleware from `sockets/middleware` by `order`, then recursively loads event modules under `sockets`, skipping `init.js`, `middleware`, and `tests` (source: `sockets/init.js:initSocketRoutes`).

Current socket modules cover:

- Backward-compatible API socket auth and legacy event names (source: `sockets/backwards-compat.js`, `sockets/middleware/api.js`).
- User logout and class update events (source: `sockets/user.js`, `sockets/updates.js`).
- Joining/leaving active classes and rooms (source: `sockets/class.js`).
- Break/help flows (source: `sockets/break.js`, `sockets/help.js`).
- Digipog socket behavior (source: `sockets/digipogs.js`).
- Poll creation, updates, responses, saves, shares, and removals (source: `sockets/polls/*.js`, `services/poll-service.js`).

For visual dependency maps, see [Architecture Diagrams](./architecture.md). For a full file inventory of every directory, see [Codebase Map](./codebase-map.md).
