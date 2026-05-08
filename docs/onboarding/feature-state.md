# Feature State

When to read this: before promising product behavior to an integrator or planning follow-up work.

Back to: [Onboarding Home](./README.md)

This file captures feature areas that are implemented, deprecated, or not fully finished as of this repository state.

## Implemented Feature Areas

These areas have live code in the current tree; many are also covered by controller, service, socket, middleware, or module tests:

- Versioned REST API under `/api/v1` (source: route mounting loop in `app.js`).
- Swagger/OpenAPI docs at `/docs`, plus JSON at `/docs.json` and `/docs/openapi.json` (source: `modules/web-server.js:createServer`).
- Socket.IO realtime events for class membership, class updates, breaks, help, digipogs, and polls (source: `sockets/init.js:initSocketRoutes`, `sockets/*.js`, `sockets/polls/*.js`).
- Registration, login, refresh, guest login, email verification support, password reset, PIN reset, and PIN verification (source: `services/auth-service.js`, `services/user-service.js`, auth/user controllers under `api/v1/controllers/**`).
- OIDC login provider discovery and callbacks for configured Google/Microsoft providers (source: `modules/oidc.js`, `api/v1/controllers/auth/oidc/providers.js`, `.env-template`).
- OAuth app registration, authorize, token, refresh, and revoke flows (source: `api/v1/controllers/apps/register-app.js`, `api/v1/controllers/oauth/*.js`, `services/auth-service.js`).
- API key based access (source: `services/api-key-service.js:resolveAPIKey`, `middleware/authentication.js:isAuthenticated`).
- Users, roles, scopes, global permissions, class roles, ban/unban, and class membership (source: `services/user-service.js`, `services/role-service.js`, `modules/scopes.js`, `modules/permissions.js`, `services/class-membership-service.js`).
- Class creation, enrollment, joining/leaving, start/end, active state, settings, students, links, timers, breaks, help requests, and polls (source: `services/class-service.js`, `services/class-membership-service.js`, `services/poll-service.js`, class controllers under `api/v1/controllers/class/**`).
- Digipog transfers, awards, pools, pool payout, transaction history, inventory/items, and notifications (source: `services/digipog-service.js`, `services/inventory-service.js`, `services/notification-service.js`).
- IP whitelist/blacklist management (source: `api/v1/controllers/ip.js`, `services/ip-service.js`, `middleware/authentication.js:refreshIPAccessCache`).
- Logs and manager/admin support endpoints (source: `api/v1/controllers/logs.js`, `services/log-service.js`, `api/v1/controllers/manager/manager.js`, `services/manager-service.js`).

## Partial Or Follow-Up Areas

### Scheduled Token Cleanup

`middleware/authentication.js` defines `cleanRefreshTokens()`, which deletes expired refresh tokens and expired used authorization codes. The scheduled startup block in `app.js` is commented out with `@TODO fix`, so cleanup does not currently run on an interval during normal server runtime (source: `middleware/authentication.js:cleanRefreshTokens`, commented cleanup block in `app.js`).

Impact: expired token rows and used authorization code rows may remain until cleanup is called by future code or manual maintenance. Token validation still checks token validity before use.

### Legacy API Compatibility

`app.js` keeps non-versioned `/api/*` compatibility for v1 and adds deprecation headers.

Impact: new clients and new documentation should use `/api/v1`. Legacy aliases should not be expanded except to preserve existing behavior.

### Deprecated Route Aliases

Some route files expose older aliases with `Warning` headers, including older user verification, class link changes, and break approval paths (source: `api/v1/controllers/user/verify.js`, `api/v1/controllers/class/links/change.js`, `api/v1/controllers/class/links/remove.js`, `api/v1/controllers/class/break/approve.js`).

Impact: route work should prefer the canonical endpoint named in the warning header. Tests should cover canonical behavior and only cover aliases when compatibility is the behavior under change.