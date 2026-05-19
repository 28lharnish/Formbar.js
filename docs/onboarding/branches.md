# Git Branches

Read this when you need to know which branch to base work on, what is deployed, or what is landing next.

Back to: [Onboarding Home](./README.md)

Formbar.js uses three long-lived branches: `main`, `RC`, and `DEV`. Feature work usually starts on a short-lived branch and merges into `DEV` first.

## Branch Ladder

```text
feature/*  -->  DEV  -->  RC  -->  main
                 ^         ^         ^
           integration   release    production
```

| Branch | Role | Typical use |
|---|---|---|
| `DEV` | Active integration | Day-to-day development; merge feature branches here |
| `RC` | Release candidate | Stabilized pre-production; soak testing before production |
| `main` | Production | What backs the live API today; merge only when a release is ready |

Upstream remote: `https://github.com/csmith1188/Formbar.js.git` (`origin`). Fetch before comparing:

```bash
git fetch origin
```

## `main` (production)

**Purpose:** Production branch. The live API documented at [formbarapi.yorktechapps.com/docs](https://formbarapi.yorktechapps.com/docs) runs from this line of development.

**Architecture note:** `main` still carries the older Formbar.js layout (bundled EJS views under `views/`, legacy routes under `routes/`, and related static assets). It does **not** match the API-only structure described in the rest of this onboarding set (`api/v1/controllers/`, `services/`, and so on). Treat `main` as the deployed legacy stack until `RC` is promoted.

**Snapshot (2026-05-19, `origin/main`):**

| | |
|---|---|
| Tip commit | `96f227f7` — Merge pull request #1042 from mason26611/main |
| Last commit date | 2026-04-13 |
| vs `RC` | `main` is **7** commits ahead, **634** commits behind |

**Commits on `main` not yet in `RC` (hotfixes / backports):**

- Backport `GET /user/:id/classes` (stable pagination for user classes)
- `hasClassPermission` fixes for managers when classes are not loaded
- Error message updates and related small fixes

**What to expect when checking out `main`:** Older directory layout, in-repo frontend pages, and permission models that predate the scope-based rewrite on `RC`.

## `RC` (release candidate)

**Purpose:** Pre-production staging for the next major backend release. This is the target for promoting work out of `DEV` once it is tested and agreed ready for wider soak.

**Architecture note:** `RC` is the rewritten API-only backend (versioned `/api/v1`, `services/`, scope-based roles, Socket.IO without bundled EJS). Most onboarding docs describe this tree.

**Snapshot (2026-05-19, `origin/RC`):**

| | |
|---|---|
| Tip commit | `21518005` — Recommend npm run build:docs instead of manually running the node command in onboarding docs |
| Last commit date | 2026-05-15 |
| vs `main` | **634** commits ahead (full rewrite plus follow-up work) |
| vs `DEV` | **116** commits behind `DEV` |

**Major themes currently in `RC` but not in `main`:**

- **API rewrite:** Controllers under `api/v1/controllers/`, shared logic in `services/`, typed errors, Jest coverage across controllers/services/sockets
- **Scope-based permissions:** Fine-grained scopes, custom class roles, multi-role students, guest login, privilege-escalation guards
- **Auth and integrations:** Google and Microsoft OIDC, OAuth app registration and token flows, generalized API keys, JWT refresh handling
- **Classroom and polls:** Class settings API, kick/regenerate code, poll history improvements, pagination across list endpoints
- **Digipogs and economy:** Transfer and pool behavior aligned with new permission checks
- **Operations:** IP whitelist/blacklist, rate limiter keyed by user, database indexes, structured logging
- **Documentation:** Onboarding markdown/HTML build (`npm run build:docs`), `AGENTS.md`, README updates
- **Removals:** Student tags and games-related scopes; legacy in-repo UI (`views/`, old `routes/` tree) dropped in favor of the separate TypeScript frontend

**Not in `RC` yet:** Work that has landed on `DEV` after the latest `RC` merge (see below).

## `DEV` (active development)

**Purpose:** Integration branch for in-progress features and fixes. Open PRs and day-to-day work should target `DEV` unless you are explicitly doing a production hotfix on `main` or a release-only fix on `RC`.

**Architecture note:** Same API-only layout as `RC`. `DEV` is `RC` plus newer commits; it is the default branch to clone for backend feature work.

**Snapshot (2026-05-19, `origin/DEV`):**

| | |
|---|---|
| Tip commit | `8d86186b` — Update endpoint paths |
| Last commit date | 2026-05-17 |
| vs `RC` | **116** commits ahead |
| vs `main` | **750** commits ahead |

**Themes in `DEV` but not yet in `RC`:**

- **Poll saving and templates:** HTTP endpoints for saving poll templates; empty-poll archive guard; poll options (`blindUntilEnded`, auto-end timer/threshold, time limits); correct-answer poll support
- **Trades:** User trade create/accept/reject/cancel/list under `/api/v1/user/{id}/trades`; trade schema and service updates
- **OAuth apps:** Application scopes, client-secret-based token exchange, OAuth grants table, `/oauth/authorize/metadata`, app-scope enforcement on controllers
- **API keys:** Generalized API key resolution and regeneration; cache store updates; removal of redundant migrations
- **Inventory and items:** Item lookup endpoint, inventory underflow handling, pog meter on user records
- **Class and permissions:** Class ban endpoint; `class.timer.read` for students; class-update broadcast when a class starts; stricter API parameter validation
- **Rate limiting:** Shared rate-limiter library and updated socket/HTTP tests
- **Fixes merged from feature branches:** Previous-polls behavior, `is-active` class state, trade-system and OAuth follow-ups

**Rough diff size vs `RC`:** about **108** files changed (large touch areas include poll controllers/services, OAuth, trades, API keys, migrations 34–41, and related tests).

## Choosing A Branch

| Situation | Branch |
|---|---|
| New feature or bugfix for the rewritten API | Branch from `DEV`, PR into `DEV` |
| Stabilize for a near-term release | Merge `DEV` → `RC`, test on `RC` |
| Production deployment | Merge `RC` → `main` after release sign-off |
| Urgent fix for live production only | Branch from `main`, backport to `RC`/`DEV` as needed |

## Inspecting Branch Differences Locally

Replace branch names if your remotes differ:

```bash
git fetch origin

# Commits on DEV not in RC
git log origin/RC..origin/DEV --oneline

# Commits on RC not in main
git log origin/main..origin/RC --oneline

# Files changed between RC and DEV
git diff --stat origin/RC..origin/DEV
```

## Keeping This Page Accurate

Branch tips and commit counts change quickly. Refresh the **Snapshot** tables and theme lists after major merges:

```bash
git fetch origin
git log -1 --format="%h %ci %s" origin/main origin/RC origin/DEV
git rev-list --count origin/main..origin/RC
git rev-list --count origin/RC..origin/DEV
git rev-list --count origin/RC..origin/main
```

Update the date in each snapshot section when you revise the numbers.
