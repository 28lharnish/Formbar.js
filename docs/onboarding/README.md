# Formbar.js Onboarding

Start here if you are new to this project.

Formbar.js is the backend for a classroom management and polling app. It handles user accounts, classes, live class state, polls, timers, help and break requests, digipogs, notifications, API keys, OAuth/OIDC login, and admin tools.

This repo is mainly a Node.js API and Socket.IO server. The frontend is expected to run separately. Local frontend configuration is controlled by `FRONTEND_URL` in `.env`.

## The Big Picture

The project has three main code layers:

```text
HTTP controllers and socket handlers
        call
services
        call
modules, stores, and the SQLite database
```

That means most new work follows this pattern:

1. Find the controller or socket event where the request enters the app.
2. Put the main business rule in a service.
3. Store durable data in SQLite through `modules/database.js`.
4. Store temporary live state in `stores/**` only when it is okay to lose that state on restart.
5. Add or update tests near the code you changed.

## First Hour Setup

Prerequisites:

- Node.js 18 or newer
- npm

From the repo root:

```bash
npm install
```

For a fresh local database:

```bash
npm run init-db
```

`npm run init-db` creates `database/database.db` from `database/init.sql`, then runs migrations. If the database already exists, the command prints a message and exits. That is fine. Keep the existing database and run:

```bash
npm run migrate
```

Start the backend:

```bash
npm run dev
```

Then open:

```text
http://localhost:420/docs
```

For the formatted onboarding docs, open:

```text
docs/onboarding/html/index.html
```

After editing any onboarding markdown file, rebuild the HTML docs with:

```bash
node docs/onboarding/build-html.js
```

Run tests:

```bash
npm test
```

If the app exits with `The database file does not exist`, run `npm run init-db`.

## Generated Local Files

The app can create a few local files during setup:

- `.env` is copied from `.env-template` if missing.
- `public-key.pem` and `private-key.pem` are generated if missing.
- `database/database.db` is created by `npm run init-db`.
- `database/database.bak` or numbered backup files may be created by `npm run migrate`.

Do not commit local secrets, generated keys, or database files.

## Reading Order

Read only what you need, but this order works well for a new contributor:

1. [Project Map](./project-map.md): where code lives and where new code usually belongs.
2. [Runtime Flow](./runtime-flow.md): what happens during startup, HTTP requests, and socket events.
3. [Data And Auth](./data-and-auth.md): database rules, migrations, tokens, API keys, roles, and scopes.
4. [Developer Workflow](./dev-workflow.md): commands, tests, and common change patterns.
5. [Architecture Diagrams](./architecture.md): visual maps of the backend.
6. [Codebase Map](./codebase-map.md): detailed directory and file inventory.
7. [Feature State](./feature-state.md): what is implemented, partial, deprecated, or risky.

## If Your Task Is...

| Task | Start Here | You Will Probably Change |
|---|---|---|
| Add or change a REST endpoint | `api/v1/controllers/**` | A controller, a service, tests, and maybe OpenAPI comments |
| Add or change realtime behavior | `sockets/**` | A socket module, a service, socket tests |
| Change class, poll, role, user, digipog, or notification rules | `services/**` | A service and its tests |
| Change persisted data | `database/migrations/**` | A new migration, service queries, `modules/test-helpers/test-schema.sql` |
| Change auth or permissions | `middleware/authentication.js`, `middleware/permission-check.js`, `modules/scopes.js`, `services/role-service.js` | Middleware, scopes/roles, tests |
| Change temporary live state | `stores/**` | A store and service code that uses it |
| Change API documentation | Controller JSDoc and `docs/components/schemas/**` | OpenAPI comments or schema YAML |

## Beginner Glossary

- Controller: Express route code that receives an HTTP request and returns an HTTP response.
- Socket handler: Socket.IO event code that receives realtime client events and emits realtime updates.
- Service: shared business logic. Controllers and socket handlers should call services instead of duplicating rules.
- Middleware: code that runs before a controller or socket event, often for logging, auth, rate limiting, or permission checks.
- Durable state: data stored in SQLite and expected to survive restart.
- Runtime state: in-memory data under `stores/**`; it disappears when the Node process restarts.
- Scope: a named permission such as "can manage users" or "can vote in polls".

## Rules Of Thumb

- Put shared behavior in `services/**`.
- Keep HTTP request/response details in `api/v1/controllers/**`.
- Keep realtime event wiring in `sockets/**`.
- Use `modules/database.js` helpers for database access.
- Add new schema changes as new migration files. Do not edit `database/init.sql` or old migrations.
- Update tests when behavior changes.
- Prefer existing patterns in nearby files over inventing a new structure.

## Common Pitfalls

### Querying The Database Inside A Loop

Avoid one database query per item. Batch the query when possible.

```js
// Bad: one query per user.
for (const userId of userIds) {
    const user = await dbGet("SELECT * FROM users WHERE id = ?", [userId]);
    results.push(user);
}

// Good: one query for all users.
const placeholders = userIds.map(() => "?").join(", ");
const users = await dbGetAll(
    `SELECT * FROM users WHERE id IN (${placeholders})`,
    userIds
);
```

This matters because SQLite calls are serialized. Looping over queries can make HTTP requests and socket events slow.

### Putting Business Rules In Controllers Or Socket Handlers

Controllers and socket handlers should validate input, call a service, and return or emit the result. If the same rule might matter to both HTTP and realtime behavior, it belongs in `services/**`.

### Confusing Stores With The Database

`stores/**` are in memory. They reset when the server restarts. Anything that must survive a restart belongs in SQLite.

### Editing Old Database History

Do not edit `database/init.sql` or an existing file under `database/migrations/**`. Add a new migration instead. Old migrations may already have run in another environment.

### Forgetting The Test Schema

Tests use `modules/test-helpers/test-schema.sql`. If you change table structure, update the test schema too.

### Regenerating RSA Keys

Deleting or replacing `public-key.pem` or `private-key.pem` invalidates existing JWT access and refresh tokens. All logged-in users will need to sign in again.

### Expanding Legacy API Paths

New code should use `/api/v1`. The non-versioned `/api` compatibility layer exists for old clients and should not grow unless the goal is explicitly legacy compatibility.

### Wrong Socket Module Export

Every socket event module must export:

```js
run(socket, socketUpdates)
```

If the export shape is wrong, the module may load but its events will not register correctly.

### Missing Proxy Trust

When deployed behind a reverse proxy such as nginx, set `TRUST_PROXY`. Without it, Express may treat all traffic as coming from the proxy IP, which can break rate limiting and IP access checks.

### Email Disabled Locally

Local `.env` defaults to `EMAIL_ENABLED=false`. Email verification, password reset, and PIN reset flows behave differently when email is disabled. Test those flows with email enabled before shipping email-related work.
