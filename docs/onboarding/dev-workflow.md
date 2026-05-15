# Developer Workflow

Read this before starting a ticket, changing schema, adding an endpoint, or opening a PR.

Back to: [Onboarding Home](./README.md)

## Local Setup

Install dependencies:

```bash
npm install
```

Create a local database if you do not have one:

```bash
npm run init-db
```

If the database already exists, run migrations instead:

```bash
npm run migrate
```

Start the server:

```bash
npm run dev
```

Open API docs:

```text
http://localhost:420/docs
```

## Local Environment Notes

`modules/config.js` copies `.env-template` to `.env` if `.env` is missing. Review `.env-template` before assuming optional integrations are enabled.

Common local settings:

| Setting | Why You Might Change It |
|---|---|
| `PORT` | Run the backend on a different port |
| `FRONTEND_URL` | Point auth/email flows at your local frontend |
| `ENABLE_CORS` | Allow browser calls from a separately hosted frontend during development |
| `EMAIL_ENABLED` | Test email verification, password reset, and PIN reset honestly |
| `GOOGLE_OIDC_*`, `MICROSOFT_OIDC_*` | Enable OIDC login providers |

## Daily Commands

| Command | What It Does |
|---|---|
| `npm run dev` | Starts the server with `nodemon` |
| `npm start` | Starts the server once with `node app` |
| `npm test` | Runs the Jest suite |
| `npm run init-db` | Creates `database/database.db`, then runs migrations |
| `npm run migrate` | Runs all migrations against the current database |
| `npm run format` | Formats JavaScript files with Prettier |
| `npm run format:check` | Checks JavaScript formatting |
| `node docs/onboarding/build-html.js` | Rebuilds the formatted onboarding HTML pages from markdown |

## Before You Start A Ticket

1. Pull or update your branch if that is part of your workflow.
2. Read the relevant onboarding doc.
3. Search for similar code with `rg`.
4. Identify the owner:
   - HTTP request: `api/v1/controllers/**`
   - Socket event: `sockets/**`
   - Shared rule: `services/**`
   - Schema/data shape: `database/migrations/**`
   - Auth/scope: `middleware/**`, `modules/scopes.js`, `services/role-service.js`
5. Run a focused test before changing code when practical. It gives you a baseline.

Useful searches:

```bash
rg "router\\.post" api/v1/controllers/class
rg "hasClassScope" api/v1/controllers sockets
rg "dbGetAll" services
rg "SocketUpdates" services sockets
```

## Standard Change Flow

1. Find the nearest existing pattern.
2. Put business logic in a service.
3. Keep controllers and socket handlers thin.
4. Use typed errors from `errors/**`.
5. Add or update tests.
6. Run the focused test.
7. Run `npm run format:check` or `npm run format`.
8. Run `npm test` when practical.

## Adding A REST Endpoint

1. Add or update a file under `api/v1/controllers/**`.
2. Use `/api/v1` as the public versioned path.
3. Add route middleware for auth, verification, class membership, and scopes as needed.
4. Call a service for the main behavior.
5. Keep response shape consistent with nearby routes.
6. Add OpenAPI JSDoc if the endpoint is public.
7. Add controller tests, usually under `api/v1/controllers/tests/*.spec.js`.

Controller sketch:

```js
module.exports = (router) => {
    router.post("/class/:id/example", isAuthenticated, hasClassScope(SCOPE), async (req, res) => {
        const result = await exampleService.doThing(req.params.id, req.user, req.body);
        res.json(result);
    });
};
```

## Adding A Socket Event

1. Add or update a file under `sockets/**`.
2. Export `run(socket, socketUpdates)`.
3. Register one or more `socket.on(...)` handlers.
4. Use `modules/socket-event-middleware.js` helpers when nearby socket files do.
5. Call services for business logic.
6. Emit updates through `socketUpdates` when broadcasting class or user state.
7. Add socket tests under `sockets/tests/*.spec.js`.

Socket sketch:

```js
module.exports = {
    run(socket, socketUpdates) {
        socket.on("example:event", async (payload) => {
            // validate, call service, emit result
        });
    },
};
```

## Changing Schema

Follow this checklist every time:

1. Add a new migration. Do not edit `database/init.sql` or old migrations.
2. Make the migration safe to run more than once.
3. Update `modules/test-helpers/test-schema.sql`.
4. Update service queries.
5. Add or update tests.
6. Run `npm run migrate` locally.
7. Run the relevant tests.

Read [Data And Auth](./data-and-auth.md) before writing migrations. The migration runner re-runs all migration files every time.

## Changing Auth Or Permissions

1. Identify whether the rule is global or class-specific.
2. Prefer scopes over numeric permission levels.
3. Add or update constants in `modules/scopes.js` when needed.
4. Update role defaults or role resolution when needed.
5. Enforce the rule in HTTP middleware and matching socket paths.
6. Test allowed and denied cases.

Common files:

| File | Use |
|---|---|
| `middleware/authentication.js` | Login state, API keys, JWTs, email verification, IP checks |
| `middleware/permission-check.js` | HTTP scope and class membership middleware |
| `modules/socket-event-middleware.js` | Socket event auth/scope helpers |
| `modules/scopes.js` | Scope constants |
| `services/role-service.js` | Role persistence and class roles |

## Test Layout

Tests are grouped by the code they cover:

| Location | Covers |
|---|---|
| `api/v1/controllers/tests/*.spec.js` | REST endpoints |
| `services/tests/*.spec.js` | Service logic |
| `sockets/tests/*.spec.js` | Socket behavior |
| `middleware/tests/*.spec.js` | Express middleware |
| `modules/tests/*.spec.js` | Shared modules and helpers |
| `modules/test-helpers/**` | Shared test database and request helpers |

Most service and controller tests use an in-memory SQLite database from `modules/test-helpers/db.js`, initialized with `modules/test-helpers/test-schema.sql`. That keeps tests isolated from your local `database/database.db`.

Run one focused Jest file when iterating:

```bash
npm test -- api/v1/controllers/tests/class-polls.spec.js
```

Then run the full suite when practical:

```bash
npm test
```

## Debugging Tips

| Problem | First Checks |
|---|---|
| App will not start | Does `database/database.db` exist? Did migrations run? |
| Route returns 404 | Is the controller under `api/v1/controllers/**` and exporting a function? |
| Route returns auth error | Check bearer token/API key, `isAuthenticated`, `isVerified`, class membership, and scopes |
| Swagger is missing an endpoint | Check OpenAPI JSDoc and that the file is inside `api/v1/**` |
| Socket event does nothing | Check `run(socket, socketUpdates)` export and event name |
| Socket permission differs from HTTP | Compare socket helper usage to route middleware |
| Data disappears after restart | Check whether it was stored only in `stores/**` |
| Rate limiting affects everyone | Check `TRUST_PROXY` and request IP behavior |

## Before Handing Off

Use this quick checklist:

```text
[ ] Code follows nearby patterns.
[ ] Controllers/socket handlers stay thin.
[ ] Shared rules live in services.
[ ] Schema changes include a new idempotent migration.
[ ] Test schema is updated when schema changes.
[ ] Tests cover success and important failure cases.
[ ] Focused tests pass.
[ ] Formatting is checked.
[ ] Any skipped full-suite test is mentioned in handoff notes.
```
