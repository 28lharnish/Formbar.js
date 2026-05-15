# Project Map

Read this when you need to know where code lives or where to put a change.

Back to: [Onboarding Home](./README.md)

## Mental Model

Formbar.js is organized by responsibility:

```text
api/v1/controllers/  HTTP entry points
sockets/             realtime entry points
services/            shared business rules
modules/             shared infrastructure helpers
stores/              temporary in-memory state
database/            SQLite schema and migrations
middleware/          Express request pipeline
errors/              typed errors
```

Most feature work touches at least one entry point and one service.

## Top-Level Directories

| Path | What It Is | Beginner Rule |
|---|---|---|
| `api/v1/controllers/` | Express route modules for the REST API | Use this for HTTP paths like `GET /api/v1/user/me` |
| `sockets/` | Socket.IO middleware and event handlers | Use this for realtime events |
| `services/` | Business logic shared by HTTP, sockets, startup, and tests | Put rules here first when behavior is not purely HTTP-specific |
| `middleware/` | Express middleware | Use this for request-wide concerns such as auth, scopes, logging, rate limiting, and error handling |
| `modules/` | Reusable infrastructure | Use this for database helpers, config, crypto, email, permissions, OIDC, logging, and small utilities |
| `stores/` | In-memory runtime state | Use this only for data that can disappear on restart |
| `database/` | SQLite init and migrations | Add new migrations here for schema or data-shape changes |
| `errors/` | Typed application errors | Throw these so responses are normalized by the error handler |
| `email-templates/` | Handlebars templates | Edit these for outgoing email content |
| `docs/components/schemas/` | OpenAPI schema YAML | Edit these when public API response/request models change |

## Dependency Direction

Prefer this direction:

```text
controllers/sockets -> services -> modules/stores/database
```

Avoid this:

```text
services -> controllers
modules -> services
stores -> controllers
```

The goal is simple: entry points know about the outside world, services know the product rules, and modules/stores/database provide support.

## Where To Add Code

| You Need To... | Add Or Change |
|---|---|
| Add a REST endpoint | A file under `api/v1/controllers/**`; shared logic in `services/**` |
| Add a socket event | A file under `sockets/**`; shared logic in `services/**` |
| Add a database table or column | A new migration under `database/migrations/**`; update services and tests |
| Add a reusable helper | `modules/**`, if it is infrastructure or utility code |
| Add temporary live state | `stores/**`, if it should reset on restart |
| Add a new typed error | `errors/**` |
| Add public API docs | Controller JSDoc plus `docs/components/schemas/**` if a shared schema is useful |

## HTTP Controller Layout

`app.js` recursively loads JavaScript files from `api/<version>/controllers`. For this repo, the active version is `api/v1/controllers`.

Each controller file exports a function that receives an Express router:

```js
module.exports = (router) => {
    router.get("/example", middleware, async (req, res) => {
        // request/response code here
    });
};
```

Common route groups:

| Group | Path |
|---|---|
| Auth | `api/v1/controllers/auth/**` |
| OAuth app flow | `api/v1/controllers/oauth/**` |
| Users | `api/v1/controllers/user/**` |
| Classes | `api/v1/controllers/class/**` |
| Class polls | `api/v1/controllers/class/polls/**` |
| Class tools | `api/v1/controllers/class/break/**`, `help/**`, `timer/**`, `links/**`, `roles/**` |
| Digipogs | `api/v1/controllers/digipogs/**` |
| Pools | `api/v1/controllers/pools/**` |
| Admin/system | `config.js`, `certs.js`, `logs.js`, `ip.js`, `manager/**` |
| Notifications | `api/v1/controllers/notifications/**` |
| App registration | `api/v1/controllers/apps/**` |

`api/v1/controllers/controller-template.js` is only an example. It is not a live route.

## Service Layout

Services are where most product behavior belongs.

| Service | Owns |
|---|---|
| `auth-service.js` | Register, login, JWTs, refresh tokens, OAuth token exchange |
| `user-service.js` | User profile, verification, password, PIN, email-related user flows |
| `api-key-service.js` | API key hashing, lookup, and cache use |
| `class-service.js` | Class lifecycle, settings, start/end, codes, active state |
| `class-membership-service.js` | Enroll, join, leave, kick, ban, unban |
| `classroom-service.js` | Live class/user state in `class-state-store` |
| `poll-service.js` | Poll creation, active polls, responses, history, sharing |
| `role-service.js` | Global roles, class roles, scope assignment |
| `student-service.js` | Student-shaped user data |
| `digipog-service.js` | Awards, transfers, pools, payouts |
| `inventory-service.js` | Items and inventory |
| `notification-service.js` | Notifications |
| `app-service.js` | Registered external apps and redirect URIs |
| `socket-updates-service.js` | Helpers that emit realtime updates |
| `ip-service.js` | IP allowlist/denylist data |
| `log-service.js` | Log queries |
| `manager-service.js` | Manager/admin dashboard data |
| `bootstrap-service.js` | Startup data seeding |

## Socket Layout

`sockets/init.js` does two things whenever a client connects:

1. Loads socket middleware from `sockets/middleware/**` in `order`.
2. Recursively loads socket event modules under `sockets/**`.

Every socket event file must export:

```js
module.exports = {
    run(socket, socketUpdates) {
        // socket.on(...) handlers here
    },
};
```

Important socket files:

| File | Handles |
|---|---|
| `sockets/class.js` | Join/leave class rooms and class session behavior |
| `sockets/user.js` | User-level realtime events |
| `sockets/updates.js` | Class update pushes |
| `sockets/break.js` | Break request flow |
| `sockets/help.js` | Help request flow |
| `sockets/digipogs.js` | Digipog realtime behavior |
| `sockets/polls/*.js` | Poll create, respond, update, save, share, remove |
| `sockets/backwards-compat.js` | Legacy socket event aliases |

Socket middleware:

| File | Handles |
|---|---|
| `sockets/middleware/authentication.js` | Socket user auth |
| `sockets/middleware/api.js` | API socket compatibility |
| `sockets/middleware/rate-limiter.js` | Socket rate limiting |
| `sockets/middleware/inactivity.js` | Inactivity tracking |

## A Typical Change

Example: "Add an endpoint that lets a teacher clear a class timer."

1. Find nearby routes in `api/v1/controllers/class/timer/**`.
2. Find the owning behavior in `services/class-service.js` or a related timer helper.
3. Add the route in the controller.
4. Put shared rules in the service.
5. Add or update tests in `api/v1/controllers/tests/class-timer.spec.js`.
6. Run that test, then run the broader suite when practical.

## How To Find Existing Patterns

Use `rg` from the repo root:

```bash
rg "hasClassScope" api/v1/controllers/class
rg "SocketUpdates" sockets services
rg "dbGetAll" services
rg "SCOPES.CLASS.POLL" .
```

Copy the structure of nearby code before creating a new pattern.
