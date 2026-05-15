# Runtime Flow

Read this when startup, route loading, authentication, request handling, or socket events are confusing.

Back to: [Onboarding Home](./README.md)

## One-Screen Summary

```text
app.js
  checks database/database.db
  creates Express + HTTP + Socket.IO through modules/web-server.js
  loads config, auth, logging, rate limits, sessions, parsers, IP checks
  mounts every controller under /api/v1
  mounts legacy /api compatibility for old clients
  initializes Socket.IO routes
  installs 404 and error handlers
  starts listening on settings.port
```

The default local port is `420`, so local docs are usually at:

```text
http://localhost:420/docs
```

## Startup Flow

1. `app.js` registers module aliases such as `@services` and `@modules`.
2. `app.js` loads environment variables with `dotenv`.
3. `app.js` checks that `database/database.db` exists.
4. If the database file is missing, startup stops and tells you to run `npm run init-db`.
5. `modules/web-server.js` creates the Express app, HTTP server, Socket.IO server, and Swagger/OpenAPI docs.
6. `modules/config.js` loads runtime settings, copies `.env-template` to `.env` if needed, and creates RSA key files if needed.
7. OIDC providers are initialized from env values.
8. Express middleware is applied: request logger, rate limiter, session middleware, body parsers, and IP access checks.
9. `app.js` loads controller files from `api/v1/controllers/**` and mounts them under `/api/v1`.
10. `app.js` mounts legacy non-versioned `/api` compatibility for old v1 clients.
11. `sockets/init.js` wires Socket.IO middleware and event modules.
12. The 404 handler and error handler are added last.
13. `http.listen(settings.port)` starts the server.
14. After listen starts, startup code ensures the Formbar Developer Pool exists and refreshes the IP access cache.

## HTTP Request Flow

An HTTP request follows this path:

```text
client
  -> Express app
  -> global middleware
  -> route-specific auth/scope middleware
  -> controller in api/v1/controllers/**
  -> service in services/**
  -> database/modules/stores as needed
  -> controller response
  -> error handler if something throws
```

What each layer should do:

| Layer | Responsibility |
|---|---|
| Global middleware | Logging, rate limiting, session setup, body parsing, IP allow/deny |
| Route middleware | Authentication, email verification, class membership, scope checks |
| Controller | Read request input, call a service, return HTTP response |
| Service | Enforce product rules and coordinate data changes |
| Modules | Shared infrastructure such as database, crypto, mail, logging |
| Stores | Temporary live state |
| Error handler | Turn typed errors into consistent JSON responses |

## API Versioning

New endpoints should use:

```text
/api/v1/...
```

`app.js` also supports old non-versioned paths under:

```text
/api/...
```

Those legacy paths add deprecation headers. Treat them as compatibility support, not as a pattern for new routes.

Some individual route files also keep old aliases for old clients. Prefer the canonical route in new code and tests unless you are specifically working on compatibility.

## Socket Connection Flow

A Socket.IO connection follows this path:

```text
client
  -> Socket.IO server
  -> shared Express session middleware
  -> IP allow/deny check
  -> sockets/init.js
  -> socket middleware in sockets/middleware/**
  -> socket event modules in sockets/**
  -> services/**
  -> SocketUpdates emits responses or class updates
```

Important details:

- `sockets/init.js` creates a `SocketUpdates` instance for each connection.
- Socket middleware is sorted by each module's `order` value.
- Socket event modules must export `run(socket, socketUpdates)`.
- Socket handlers should call services for business rules.
- Realtime state often lives in `stores/**`, so check whether a bug disappears after restart.

## Error Flow

Prefer typed errors from `errors/**`:

- `AuthError`
- `ValidationError`
- `ForbiddenError`
- `NotFoundError`
- `ConflictError`
- `RateLimitError`
- `AppError`

Throwing these lets `middleware/error-handler.js` produce consistent responses. Raw `Error` objects should be rare and usually indicate unexpected failures.

## Debugging Checklist

| Symptom | Check |
|---|---|
| Server exits immediately | Does `database/database.db` exist? Run `npm run init-db` for a fresh database |
| Route does not exist | Is the file under `api/v1/controllers/**` and exporting a router registration function? |
| Route appears under `/api` but not `/api/v1` | Check whether you are hitting a legacy alias instead of the canonical path |
| Swagger does not show a route | Check controller JSDoc annotations and `modules/web-server.js` Swagger `apis` setting |
| Auth fails | Check bearer token, API key, email verification, class membership, and required scopes |
| All users are rate-limited together | Check `TRUST_PROXY` when running behind nginx or another proxy |
| Socket connects but event does nothing | Confirm the socket file exports `run(socket, socketUpdates)` |
| Socket event fires but permissions fail | Compare socket permission checks to the matching HTTP route |
| Feature works until restart | It may be stored only in `stores/**` instead of SQLite |

For diagrams of these flows, see [Architecture Diagrams](./architecture.md).
