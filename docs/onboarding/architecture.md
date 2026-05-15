# Architecture Diagrams

Read this when a picture would help you understand how the backend fits together.

Back to: [Onboarding Home](./README.md)

These diagrams are intentionally beginner-friendly. They show dependency direction and runtime flow, not every function call.

## How To Read The Diagrams

- Boxes on the left are usually entry points.
- Boxes in the middle usually contain product behavior.
- Boxes on the right usually store data, emit updates, or provide infrastructure.
- Arrows mean "calls", "loads", or "depends on".

## Main Architecture

```mermaid
flowchart LR
    Client["Client\nfrontend, test, or integration"]

    subgraph Edge["Entry points"]
        HTTP["HTTP request\n/api/v1/..."]
        Socket["Socket.IO event"]
    end

    subgraph App["App bootstrap"]
        AppJS["app.js\nstartup, middleware, route loading"]
        Web["modules/web-server.js\nExpress + HTTP + Socket.IO + Swagger"]
    end

    subgraph Adapters["Protocol adapters"]
        Controllers["api/v1/controllers/**\nHTTP controllers"]
        SocketHandlers["sockets/**\nsocket middleware + handlers"]
    end

    subgraph Domain["Domain layer"]
        Services["services/**\nbusiness rules"]
        Errors["errors/**\ntyped failures"]
    end

    subgraph Support["Support layer"]
        Modules["modules/**\nconfig, database, crypto, mail, permissions"]
        Stores["stores/**\nin-memory live state"]
        DB["SQLite\ndatabase/database.db"]
    end

    Client --> HTTP --> AppJS
    Client --> Socket --> Web
    AppJS --> Web
    AppJS --> Controllers
    AppJS --> SocketHandlers
    Controllers --> Services
    SocketHandlers --> Services
    Controllers --> Errors
    Services --> Errors
    Services --> Modules
    Services --> Stores
    Modules --> DB
```

Beginner takeaway: controllers and sockets are entry points; services hold the real rules.

## HTTP Request Lifecycle

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant App as app.js / Express
    participant Global as Global middleware
    participant Route as Route middleware
    participant Controller
    participant Service
    participant Data as DB or store
    participant Error as Error handler

    Client->>App: HTTP request
    App->>Global: logger, rate limit, session, parsers, IP check
    Global->>Route: matched /api/v1 route
    Route->>Route: auth, verification, membership, scopes
    Route->>Controller: continue when checks pass
    Controller->>Service: call business logic
    Service->>Data: read/write if needed
    Data-->>Service: result
    Service-->>Controller: result
    Controller-->>Client: JSON response

    alt error thrown
        Controller->>Error: typed or unexpected error
        Error-->>Client: normalized error response
    end
```

Beginner takeaway: a controller should not be doing heavy business logic. It should mostly translate HTTP into service calls.

## Socket Lifecycle

```mermaid
flowchart TD
    Connect["Client connects"]
    SharedSession["Shared Express session"]
    IPCheck["Socket IP allow/deny"]
    Init["sockets/init.js"]
    Updates["new SocketUpdates(socket)"]
    Middleware["sockets/middleware/**\nsorted by order"]
    Events["sockets/**\nrun(socket, socketUpdates)"]
    Services["services/**"]
    Stores["stores/**"]
    Emits["socketUpdates emits\nuser/class updates"]

    Connect --> SharedSession --> IPCheck --> Init --> Updates --> Middleware --> Events
    Events --> Services
    Services --> Stores
    Services --> Emits
```

Beginner takeaway: if a socket event should change product state, make the socket handler call a service.

## Auth Flow

```mermaid
flowchart TD
    Request["Protected HTTP request"]
    Auth["isAuthenticated()\nmiddleware/authentication.js"]
    APIKey{"API key provided?"}
    Bearer{"Bearer token provided?"}
    ResolveKey["resolveAPIKey()\nservices/api-key-service.js"]
    VerifyToken["verifyToken()\nservices/auth-service.js"]
    Guest{"Guest token?"}
    LoadDBUser["Load user from SQLite\nuser-service.js"]
    GuestStore["Load guest from classStateStore"]
    SyncStore["syncUserIntoClassStateStore()"]
    ReqUser["req.user"]
    VerifyEmail["optional isVerified()"]
    Scopes["hasScope() / hasClassScope()"]
    Deny["AuthError"]

    Request --> Auth --> APIKey
    APIKey -- yes --> ResolveKey --> LoadDBUser
    APIKey -- no --> Bearer
    Bearer -- yes --> VerifyToken --> Guest
    Bearer -- no --> Deny
    Guest -- yes --> GuestStore --> ReqUser
    Guest -- no --> LoadDBUser --> SyncStore --> ReqUser
    ReqUser --> VerifyEmail
    ReqUser --> Scopes
```

Beginner takeaway: protected routes usually get a `req.user` from either an API key or a bearer token, then route-specific middleware checks verification, class membership, and scopes.

## Persistence Vs Runtime State

```mermaid
flowchart LR
    Services["services/**"]

    subgraph Durable["Durable state\nsurvives restart"]
        DBModule["modules/database.js\ndbGet/dbRun/dbGetAll"]
        SQLite["SQLite database\nusers, classes, roles, history"]
    end

    subgraph Runtime["Runtime state\nlost on restart"]
        Stores["stores/**\nactive classes, sockets, active polls, caches"]
    end

    Services --> DBModule --> SQLite
    Services --> Stores
```

Beginner takeaway: choose SQLite for data that must still exist tomorrow; choose stores for live state that can be rebuilt.

## Database Relationships

These are conceptual relationships used by the code. The SQLite schema does not always declare every relationship as a foreign key.

### Users, Classes, And Roles

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
```

### Polls

```mermaid
erDiagram
    users ||--o{ custom_polls : owns
    custom_polls ||--o{ shared_polls : shared_with_users
    users ||--o{ shared_polls : receives
    classroom ||--o{ class_polls : shares_polls
    custom_polls ||--o{ class_polls : shared_to_class
    classroom ||--o{ poll_history : stores
    poll_history ||--o{ poll_answers : records
    users ||--o{ poll_answers : answers
```

### Apps, Digipogs, Inventory, And Notifications

```mermaid
erDiagram
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

## Service Dependency Shape

```mermaid
flowchart TB
    Entry["Controllers and sockets"]

    subgraph Services["services/**"]
        Auth["auth-service\napi-key-service\nuser-service"]
        Class["class-service\nclass-membership-service\nclassroom-service"]
        Poll["poll-service"]
        Role["role-service\nstudent-service"]
        Digipog["digipog-service\ninventory-service"]
        Admin["app, notification, ip, log, manager services"]
        Updates["socket-updates-service"]
    end

    subgraph Support["support"]
        DB["modules/database.js"]
        Perms["modules/scopes.js\npermissions.js\nscope-resolver.js"]
        Crypto["modules/crypto.js"]
        Mail["modules/mail.js"]
        RuntimeStores["stores/**"]
    end

    Entry --> Auth
    Entry --> Class
    Entry --> Poll
    Entry --> Role
    Entry --> Digipog
    Entry --> Admin
    Entry --> Updates

    Auth --> DB
    Auth --> Crypto
    Auth --> Perms
    Auth --> Mail
    Class --> DB
    Class --> RuntimeStores
    Poll --> DB
    Poll --> RuntimeStores
    Role --> DB
    Role --> Perms
    Digipog --> DB
    Admin --> DB
    Updates --> RuntimeStores
```

Beginner takeaway: if you are unsure where to put a rule, start by looking for the closest service.
