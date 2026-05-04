# Developer Workflow

When to read this: before starting a ticket, making a schema change, or opening a PR.

Back to: [Onboarding Home](./README.md)

## Local Setup

```bash
npm install
npm run init-db
npm run migrate
npm run dev
```

The default port is `420`, so local API docs are available at `http://localhost:420/docs` (source: `modules/config.js:getConfig`, `modules/web-server.js:createServer`).

`modules/config.js` copies `.env-template` to `.env` when `.env` is missing and generates RSA key files when needed (source: `modules/config.js:getConfig`, `generateKeyPair`). Review `.env-template` before assuming email, OIDC, CORS, IP access, or rate-limit settings are enabled.

## Daily Commands

- `npm run dev`: run the server with `nodemon` (source: `package.json:scripts.dev`).
- `npm start`: run the server once with `node app` (source: `package.json:scripts.start`).
- `npm test`: run the Jest suite (source: `package.json:scripts.test`).
- `npm run init-db`: initialize `database/database.db` from `database/init.sql`, then run migrations (source: `package.json:scripts.init-db`, `database/init.js:initializeDatabase`).
- `npm run migrate`: run SQL and JS migrations (source: `package.json:scripts.migrate`, `database/migrate.js:executeMigration`).
- `npm run format`: format JavaScript files with Prettier (source: `package.json:scripts.format`).
- `npm run format:check`: check JavaScript formatting with Prettier (source: `package.json:scripts.format:check`).

## Test Layout

- Controller/API tests: `api/v1/controllers/tests/*.spec.js`
- Service tests: `services/tests/*.spec.js`
- Socket tests: `sockets/tests/*.spec.js`
- Middleware tests: `middleware/tests/*.spec.js`
- Module tests: `modules/tests/*.spec.js`
- Shared helpers: `modules/test-helpers/**`

Jest configuration lives in `jest.config.js`, with setup in `jest.setup.js`. The layout above is based on the existing `*.spec.js` files in those directories.

## Change Workflow

1. Find the owning feature area in `services/**`, `api/v1/controllers/**`, or `sockets/**`.
2. Put shared behavior in the service layer when both HTTP and socket code care about it (source: controller and socket imports from `@services/**`).
3. Add or update API/socket wrappers around the service behavior.
4. Add focused tests to the broadest existing suite that can clearly cover the behavior.
5. Run the relevant test file or suite, then run `npm test` when practical.
6. Run `npm run format:check` or `npm run format` before handing off (source: `package.json:scripts.format`, `format:check`).

## API Work

Prefer endpoint-level tests for API changes. The controller tests use Supertest helpers under `api/v1/controllers/tests/helpers` (source: `api/v1/controllers/tests/helpers/test-app.js`).

When adding endpoints:

- Use `/api/v1` paths.
- Add route-specific auth, verification, class membership, and scope middleware.
- Keep response shape consistent with nearby controllers.
- Add OpenAPI JSDoc annotations when the endpoint is public.
- Reuse `errors/**` types so `middleware/error-handler.js` can shape responses consistently.

## Schema Work

Follow repository rules strictly:

- Do not modify `database/init.sql`.
- Do not edit existing migration files.
- Add a new migration for schema or data behavior changes.
- Keep migration filenames in sequence with existing history.
- Update test schema/helpers when tests depend on the changed shape.

When practical, verify persistence by checking the migrated on-disk database, not only isolated unit tests.

## Debugging Tips

- If routes do not appear in Swagger, check the controller file path and JSDoc annotations.
- If a route works under `/api` but not `/api/v1`, inspect legacy rewrite assumptions in `app.js`.
- If a socket connects but events fail, check middleware order and the active user/class state stores.
- If rate limiting looks global, check `TRUST_PROXY` and request IP behavior.
- If auth suddenly fails locally, check RSA key files and whether `.env` was recreated.
