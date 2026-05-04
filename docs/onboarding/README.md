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
6. [Feature State](./feature-state.md): current product areas, deprecated compatibility paths, and known partial work.

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
