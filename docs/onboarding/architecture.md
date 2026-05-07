# Architecture Diagrams

When to read this: when you need a visual map of the running backend, auth behavior, request flow, sockets, data relationships, or service/module dependencies.

Back to: [Onboarding Home](./README.md)

Every diagram below is intentionally tied to filenames and functions. The database diagram shows conceptual relationships used by code and table columns; the current schema does not consistently declare SQLite foreign key constraints.

## Main Architecture

```mermaid
flowchart TD
    Client["Client / frontend / integration"] --> HTTP["HTTP requests"]
    Client --> SIO["Socket.IO connection"]
    HTTP --> App["app.js\nmiddleware + dynamic routes"]
    App --> WebServer["modules/web-server.js\ncreateServer()"]
    App --> Controllers["api/v1/controllers/**"]
    Controllers --> Services["services/**"]
    SIO --> SocketInit["sockets/init.js\ninitSocketRoutes()"]
    SocketInit --> SocketMW["sockets/middleware/**\nordered run() functions"]
    SocketMW --> SocketHandlers["sockets/**\nrun(socket, socketUpdates)"]
    SocketHandlers --> Services
    Services --> DB["modules/database.js\ndbGet/dbRun/dbGetAll"]
    Services --> Stores["stores/**\nruntime state"]
    WebServer --> Docs["/docs + docs JSON\nSwagger UI"]
```

Sources: `app.js:getJSFiles`, route mounting loop in `app.js`, `modules/web-server.js:createServer`, `sockets/init.js:initSocketRoutes`, `modules/database.js:getDatabase`.

## Auth Flow

```mermaid
flowchart TD
    Request["HTTP request"] --> AuthMW["middleware/authentication.js\nisAuthenticated()"]
    AuthMW --> ApiKey{"api header/query/body?"}
    ApiKey -->|"yes"| ResolveKey["services/api-key-service.js\nresolveAPIKey()"]
    ResolveKey --> LoadApiUser["services/user-service.js\ngetUserDataFromDb()"]
    ApiKey -->|"no"| Bearer{"Authorization: Bearer token?"}
    Bearer -->|"yes"| Verify["services/auth-service.js\nverifyToken()"]
    Verify --> Guest{"decoded isGuest?"}
    Guest -->|"yes"| GuestStore["services/classroom-service.js\nclassStateStore.getUser()"]
    Guest -->|"no"| LoadUser["middleware/authentication.js\nloadComputedUserByEmail()"]
    Bearer -->|"no"| AuthError["AuthError"]
    LoadApiUser --> Sync["middleware/authentication.js\nsyncUserIntoClassStateStore()"]
    LoadUser --> Sync
    GuestStore --> ReqUser["req.user hydrated"]
    Sync --> ReqUser
    ReqUser --> VerifyEmail["middleware/authentication.js\nisVerified() when route uses it"]
    ReqUser --> ScopeCheck["middleware/permission-check.js\nhasScope()/hasClassScope()"]
```

Sources: `middleware/authentication.js:isAuthenticated`, `isVerified`, `syncUserIntoClassStateStore`, `loadComputedUserByEmail`; `services/auth-service.js:verifyToken`; `services/api-key-service.js:resolveAPIKey`; `middleware/permission-check.js:hasScope`, `hasClassScope`.

Login and token issuance are handled separately by auth controllers calling `services/auth-service.js:register`, `login`, `refreshLogin`, `loginAsGuest`, `oidcOAuthLogin`, `generateAuthorizationCode`, `exchangeAuthorizationCodeForToken`, `exchangeRefreshTokenForAccessToken`, and `revokeOAuthToken`.

## HTTP Request Lifecycle

```mermaid
sequenceDiagram
    participant C as Client
    participant A as app.js
    participant M as Express middleware
    participant R as api/v1/controllers
    participant S as services
    participant D as modules/database.js
    participant E as middleware/error-handler.js
    C->>A: HTTP request
    A->>M: requestLogger, rateLimiter, session, parsers, IP check
    M->>R: matched /api/v1 route
    R->>M: route auth / scope / class membership middleware
    R->>S: domain call
    S->>D: dbGet/dbRun/dbGetAll when persistence is needed
    D-->>S: rows/result
    S-->>R: domain result or typed error
    R-->>C: JSON/response
    R-->>E: thrown AppError/AuthError/etc.
    E-->>C: normalized error response
```

Sources: middleware order in `app.js`, dynamic controller loading in `app.js:getJSFiles`, database helpers in `modules/database.js`, error normalization in `middleware/error-handler.js`.

## Socket Flow

```mermaid
flowchart TD
    Connect["Socket.IO connection"] --> Session["app.js\nsessionMiddleware passed to io.use()"]
    Session --> IpCheck["app.js\nsocket IP allow/deny middleware"]
    IpCheck --> Init["sockets/init.js\ninitSocketRoutes()"]
    Init --> Updates["services/socket-updates-service.js\nnew SocketUpdates(socket)"]
    Updates --> MWLoad["sockets/init.js\nload middleware sorted by order"]
    MWLoad --> AuthRun["sockets/middleware/authentication.js\nrun()"]
    MWLoad --> ApiRun["sockets/middleware/api.js\nrun()"]
    MWLoad --> OtherMW["inactivity + rate limiter middleware"]
    OtherMW --> HandlerLoad["sockets/init.js\nloadSockets('.')"]
    HandlerLoad --> Events["sockets/*.js and sockets/polls/*.js\nrun(socket, socketUpdates)"]
    Events --> Guards["modules/socket-event-middleware.js\nonSocketEvent()/hasScope()/hasClassScope()"]
    Guards --> Services["services/**"]
    Services --> Emits["services/socket-updates-service.js\nadvancedEmitToClass()/emitToUser()/classUpdate()"]
```

Sources: `app.js` Socket.IO `io.use` blocks, `sockets/init.js:initSocketRoutes`, `sockets/middleware/authentication.js:run`, `sockets/middleware/api.js:run`, `modules/socket-event-middleware.js:onSocketEvent`, `services/socket-updates-service.js:SocketUpdates`.

## Database Relationships

```mermaid
erDiagram
    users ||--o{ classroom : owns
    users ||--o{ classusers : joins
    classroom ||--o{ classusers : has_members
    users ||--o{ user_roles : assigned
    roles ||--o{ user_roles : grants
    classroom ||--o{ user_roles : class_scope
    classroom ||--o{ class_roles : available_roles
    roles ||--o{ class_roles : listed
    users ||--o{ refresh_tokens : has
    users ||--o{ user_tokens : reset_verify_tokens
    users ||--o{ custom_polls : owns
    custom_polls ||--o{ shared_polls : shared_with_users
    users ||--o{ shared_polls : receives
    classroom ||--o{ class_polls : shares_polls
    custom_polls ||--o{ class_polls : shared_to_class
    classroom ||--o{ poll_history : stores
    poll_history ||--o{ poll_answers : records
    users ||--o{ poll_answers : answers
    users ||--o{ notifications : receives
    users ||--o{ inventory : owns_items
    item_registry ||--o{ inventory : item_type
    digipog_pools ||--o{ digipog_pool_users : has_members
    users ||--o{ digipog_pool_users : member
    users ||--o{ apps : owns
    apps ||--o{ app_redirect_uris : allows_redirects
    apps ||--|| item_registry : share_item
    apps ||--|| digipog_pools : developer_pool
    users ||--o{ trades : participates
```

Standalone token-tracking table: `used_authorization_codes` records consumed OAuth authorization-code hashes and expiry times (source: `database/migrations/13_used_authorization_codes.sql`, `services/auth-service.js:exchangeAuthorizationCodeForToken`, `cleanupExpiredAuthorizationCodes`).

Sources: table definitions and migrations in `database/init.sql`, `database/migrations/*.sql`, and `database/migrations/JSMigrations/*.js`; runtime queries in `services/user-service.js`, `services/class-service.js`, `services/class-membership-service.js`, `services/role-service.js`, `services/poll-service.js`, `services/digipog-service.js`, `services/inventory-service.js`, `services/app-service.js`, and `services/notification-service.js`.

## Major Service And Module Dependencies

```mermaid
flowchart LR
    Controllers["api/v1/controllers/**"] --> AuthSvc["services/auth-service.js"]
    Controllers --> UserSvc["services/user-service.js"]
    Controllers --> ClassSvc["services/class-service.js"]
    Controllers --> MembershipSvc["services/class-membership-service.js"]
    Controllers --> PollSvc["services/poll-service.js"]
    Controllers --> RoleSvc["services/role-service.js"]
    Controllers --> DigipogSvc["services/digipog-service.js"]
    Controllers --> OtherSvc["manager/log/ip/app/notification services"]
    Sockets["sockets/**"] --> ClassSvc
    Sockets --> PollSvc
    Sockets --> DigipogSvc
    Sockets --> UpdatesSvc["services/socket-updates-service.js"]
    AuthSvc --> Crypto["modules/crypto.js"]
    AuthSvc --> JWTKeys["modules/config.js\nprivateKey/publicKey"]
    AuthSvc --> Perms["modules/permissions.js + modules/scope-resolver.js"]
    UserSvc --> Mail["modules/mail.js"]
    UserSvc --> UpdatesSvc
    ClassSvc --> ClassroomSvc["services/classroom-service.js"]
    ClassSvc --> UpdatesSvc
    PollSvc --> RuntimeStore["stores/poll-runtime-store.js"]
    UpdatesSvc --> SocketStore["stores/socket-state-store.js"]
    ClassroomSvc --> ClassStore["stores/class-state-store.js"]
    RoleSvc --> Perms
    DigipogSvc --> DB["modules/database.js"]
    AuthSvc --> DB
    UserSvc --> DB
    ClassSvc --> DB
    MembershipSvc --> DB
    PollSvc --> DB
    RoleSvc --> DB
```

Sources: `require(...)` imports in `api/v1/controllers/**`, `sockets/**`, `services/auth-service.js`, `services/user-service.js`, `services/class-service.js`, `services/classroom-service.js`, `services/poll-service.js`, `services/role-service.js`, `services/socket-updates-service.js`, and `services/digipog-service.js`.
