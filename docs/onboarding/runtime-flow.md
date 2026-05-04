# Runtime Flow

When to read this: before debugging startup, request routing, socket events, or route registration.

Back to: [Onboarding Home](./README.md)

## High-Level Architecture

See [Architecture Diagrams](./architecture.md) for the full Mermaid set. The main architecture, request lifecycle, and socket flow diagrams cite the exact files/functions behind each step.

## Server Startup

1. `app.js` registers module aliases and loads environment variables (source: `app.js` top-level requires).
2. `app.js` checks for `database/database.db`; if the file is missing, it prints setup guidance and exits early (source: `app.js` database existence check).
3. `modules/web-server.js` creates the Express app, HTTP server, Socket.IO server, and Swagger/OpenAPI docs (source: `modules/web-server.js:createServer`).
4. `modules/config.js` loads runtime settings, creates `.env` from `.env-template` if missing, and generates RSA key files if needed (source: `modules/config.js:getConfig`, `generateKeyPair`).
5. OIDC providers are initialized from env configuration (source: `app.js:initializeAvailableProviders`, `modules/oidc.js:initializeAvailableProviders`).
6. Express receives request logging, rate limiting, session middleware, URL/body parsers, and IP access checks (source: middleware setup in `app.js`).
7. API route files are loaded dynamically from `api/<version>/controllers/**` (source: `app.js:getJSFiles`, route mounting loop).
8. `initSocketRoutes()` wires Socket.IO middleware and event handlers (source: `sockets/init.js:initSocketRoutes`).
9. The app attaches the 404 and error middleware, then calls `http.listen(settings.port)` (source: final middleware and listen block in `app.js`).
10. Startup bootstrap ensures the Formbar Developer Pool exists and refreshes the IP access cache (source: `services/bootstrap-service.js:ensureFormbarDeveloperPool`, `middleware/authentication.js:refreshIPAccessCache`, `app.js` listen callback).

## HTTP Request Lifecycle

1. A request enters Express through the app created in `modules/web-server.js:createServer`.
2. Global middleware runs in the order defined in `app.js`: request logger, rate limiter, session middleware, parsers, and IP access enforcement.
3. Route-specific middleware handles authentication, verification, class membership, and scope checks (source: `middleware/authentication.js`, `middleware/permission-check.js`).
4. The matched controller in `api/v1/controllers/**` handles HTTP-specific input/output (source: controller registration functions under `api/v1/controllers/**`).
5. The controller calls a service in `services/**` for the main behavior (source: service imports in controllers).
6. Services read/write SQLite through `modules/database.js` and use `stores/**` when live runtime state is needed (source: `modules/database.js:dbGet`, `dbRun`, `dbGetAll`; store imports in `services/**`).
7. Typed errors flow through `middleware/error-handler.js` (source: `middleware/error-handler.js`).

## API Versioning

Versioned endpoints mount at `/api/v1` (source: route mounting loop in `app.js`).

For compatibility, `app.js` also mounts legacy non-versioned `/api/*` paths for v1. Legacy requests receive deprecation headers, including a `Sunset` date of `Tue, 01 Sep 2026 00:00:00 GMT` (source: `app.js:attachLegacyApiDeprecationHeaders`).

Several route-level legacy aliases also exist for older clients. Treat them as compatibility support, not as patterns for new endpoints.

## Socket Lifecycle

1. Socket.IO accepts a connection from the server created in `modules/web-server.js:createServer`.
2. The Express session middleware is shared with Socket.IO (source: first `io.use` block in `app.js`).
3. A global Socket.IO middleware blocks disallowed IPs (source: second `io.use` block in `app.js`, `middleware/authentication.js:checkIPAllowed`).
4. `sockets/init.js` creates a `SocketUpdates` instance for the connection (source: `sockets/init.js:initSocketRoutes`, `services/socket-updates-service.js:SocketUpdates`).
5. Middleware files under `sockets/middleware` run in sorted `order` (source: `sockets/init.js:initSocketRoutes`).
6. Event modules under `sockets/**` register `socket.on(...)` handlers (source: `sockets/init.js:loadSockets`, `modules/socket-event-middleware.js:onSocketEvent`).
7. Socket handlers call services and update helpers to modify class state, respond to events, or emit realtime updates (source: imports in `sockets/*.js`, `sockets/polls/*.js`, `services/socket-updates-service.js`).

## Debugging Checks

- Missing API route: confirm the file is under `api/v1/controllers`, exports a registration function, and is not named `*.spec.js`.
- Missing socket behavior: confirm the module exports `run(socket, socketUpdates)` and is not under a skipped directory.
- Auth failure: check whether the route expects a bearer token, API key, verified email, class membership, or scopes.
- All requests rate-limited as one user/IP: check `TRUST_PROXY` and proxy configuration.
- Startup fails immediately: confirm `database/database.db` exists and migrations completed.
