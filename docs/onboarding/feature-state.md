# Feature State

Read this before promising behavior to another team, planning follow-up work, or deciding whether something is safe to build on.

Back to: [Onboarding Home](./README.md)

This file describes the current product surface in this repo. It is not a replacement for tests or code review, but it helps a new contributor know what is stable, partial, or legacy.

## Implemented Areas

These areas have live code in the current tree.

| Area | What Exists |
|---|---|
| Versioned REST API | Public routes are mounted under `/api/v1` |
| API docs | Swagger UI at `/docs`; JSON at `/docs.json` and `/docs/openapi.json` |
| Socket.IO realtime layer | Class updates, class membership, breaks, help, digipogs, polls, and user updates |
| User auth | Registration, login, refresh, guest login, email verification support, password reset, PIN reset, PIN verification |
| OIDC login | Google and Microsoft providers when env values are configured |
| OAuth app flow | App registration, authorize, token exchange, refresh, and revoke |
| API keys | Programmatic access through API key auth |
| Users and roles | Users, roles, scopes, global permissions, class roles, ban/unban |
| Classes | Create, enroll, join, leave, start, end, active state, settings, students, links, timers |
| Polls | Active polls, responses, saved/custom polls, sharing, history |
| Break and help tools | Student requests and teacher actions |
| Digipogs | Transfers, awards, pools, payouts, transaction history |
| Inventory and items | Item registry and user inventory |
| Notifications | List, detail, mark read, delete |
| IP access management | Whitelist/blacklist data and enforcement for HTTP and sockets |
| Admin/manager support | Logs and manager dashboard endpoints |

## Areas To Treat Carefully

### Scheduled Token Cleanup

`middleware/authentication.js` defines cleanup for expired refresh tokens and expired used authorization codes.

The interval that would run cleanup during normal startup is currently commented out in `app.js` with a `@TODO fix` note.

Impact:

- Expired rows may remain in the database longer than expected.
- Token validation still checks token validity before use.
- If you work on auth maintenance, make this explicit in tests and rollout notes.

### Legacy `/api` Compatibility

The canonical API path is:

```text
/api/v1/...
```

`app.js` also supports non-versioned `/api/...` paths for older v1 clients and adds deprecation headers.

Impact:

- New clients should use `/api/v1`.
- New docs should use `/api/v1`.
- Do not add new legacy aliases unless the task is explicitly about preserving old behavior.

### Deprecated Route Aliases

Some route files expose older aliases with warning headers. Examples include user verification, class link changes, and break approval paths.

Impact:

- Prefer canonical endpoints for new code.
- Tests should focus on canonical behavior unless compatibility is being changed.
- If deleting or changing an alias, look for explicit tests and clients that still depend on it.

### Migration History Is Not Perfectly Sequential

Migration filenames have gaps and duplicate `28_` prefixes.

Impact:

- Preserve existing migration files as history.
- Pick the next clear sequence number for new migrations.
- Do not rename old migrations just to make the list prettier.

### Runtime Stores Are Not Durable

Live class state, socket state, active polls, class-code cache, and API-key cache live in `stores/**`.

Impact:

- Runtime state resets on process restart.
- Anything that must survive restart needs a database write.
- Bugs that appear after restart often come from using a store where persistence was needed.

### Email Is Usually Disabled Locally

The local template sets:

```text
EMAIL_ENABLED=false
```

Impact:

- Email verification is bypassed locally when email is disabled.
- Password reset, PIN reset, and verification links need a real or fake SMTP target to be tested honestly.
- Do not assume an email-dependent feature is production-ready because it worked with email disabled.

## Stable Patterns To Build On

These patterns are used throughout the repo and are safe defaults for new work:

- Put business rules in `services/**`.
- Keep controllers and sockets thin.
- Use typed errors from `errors/**`.
- Use `hasScope` and `hasClassScope` for authorization.
- Use `modules/database.js` helpers for SQLite access.
- Use new idempotent migrations for schema changes.
- Add tests near the behavior you changed.

## When To Update This File

Update this file when:

- A partial area becomes complete.
- A deprecated compatibility path is removed.
- A new feature area becomes important for contributors to know.
- A major limitation or follow-up area is discovered.
