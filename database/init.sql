CREATE TABLE IF NOT EXISTS "api_keys" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    api_key_hash TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "app_redirect_uris" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL,
    redirect_uri TEXT NOT NULL,
    UNIQUE (app_id, redirect_uri)
);

CREATE TABLE IF NOT EXISTS "apps" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    owner_user_id INTEGER NOT NULL,
    share_item_id INTEGER NOT NULL,
    pool_id INTEGER NOT NULL,
    client_secret_hash TEXT
);

CREATE TABLE IF NOT EXISTS "class_polls" (
    "pollId" INTEGER NOT NULL,
    "classId" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "class_roles" (
    "roleId" INTEGER NOT NULL,
    "classId" INTEGER NOT NULL,
    orderIndex INTEGER
);

CREATE TABLE IF NOT EXISTS "classroom" (
    "id" INTEGER NOT NULL UNIQUE,
    "name" TEXT NOT NULL,
    "owner" INTEGER NOT NULL,
    "key" INTEGER NOT NULL,
    settings TEXT,
    PRIMARY KEY ("id" AUTOINCREMENT)
);

CREATE TABLE IF NOT EXISTS "classusers" (
    "classId" INTEGER NOT NULL,
    "studentId" INTEGER NOT NULL,
    "digiPogs" INTEGER,
    "tags" TEXT
);

CREATE TABLE IF NOT EXISTS "custom_polls" (
    "id" INTEGER NOT NULL UNIQUE,
    "owner" TEXT,
    "name" TEXT,
    "prompt" TEXT,
    "promptMD" TEXT,
    "promptHTML" TEXT,
    "answers" TEXT NOT NULL,
    "textRes" INTEGER NOT NULL DEFAULT 0 CHECK ("textRes" IN (0, 1)),
    "blind" INTEGER NOT NULL DEFAULT 0 CHECK ("blind" IN (0, 1)),
    "allowVoteChanges" INTEGER NOT NULL DEFAULT 1 CHECK ("allowVoteChanges" IN (0, 1)),
    "allowMultipleResponses" INTEGER NOT NULL DEFAULT 0 CHECK ("allowMultipleResponses" IN (0, 1)),
    "weight" INTEGER NOT NULL DEFAULT 1,
    "public" INTEGER NOT NULL DEFAULT 0 CHECK ("public" IN (0, 1)),
    PRIMARY KEY ("id" AUTOINCREMENT)
);

INSERT INTO "custom_polls" ("id", "owner", "name", "prompt", "promptMD", "promptHTML", "answers", "textRes", "blind", "allowVoteChanges", "weight", "public") VALUES (1, NULL, 'TUTD', 'Thumbs?', 'Thumbs?', 'Thumbs?', '[{"answer":"Up","weight":0.9,"color":"#00FF00"},{"answer":"Wiggle","weight":1,"color":"#00FFFF"},{"answer":"Down","weight":1.1,"color":"#FF0000"}]', 0, 0, 1, 1, 1);
INSERT INTO "custom_polls" ("id", "owner", "name", "prompt", "promptMD", "promptHTML", "answers", "textRes", "blind", "allowVoteChanges", "weight", "public") VALUES (2, NULL, 'True/False', 'True or False', 'True or False', 'True or False', '[{"answer":"True","weight":1,"color":"#00FF00"},{"answer":"False","weight":1,"color":"#FF0000"}]', 0, 0, 1, 1, 1);
INSERT INTO "custom_polls" ("id", "owner", "name", "prompt", "promptMD", "promptHTML", "answers", "textRes", "blind", "allowVoteChanges", "weight", "public") VALUES (3, NULL, 'Done/Ready?', 'Done/Ready?', 'Done/Ready?', 'Done/Ready?', '[{"answer":"Yes","weight":1,"color":"#00FF00"}]', 0, 0, 1, 1, 1);
INSERT INTO "custom_polls" ("id", "owner", "name", "prompt", "promptMD", "promptHTML", "answers", "textRes", "blind", "allowVoteChanges", "weight", "public") VALUES (4, NULL, 'Multiple Choice', 'Multiple Choice', 'Multiple Choice', 'Multiple Choice', '[{"answer":"A","weight":1,"color":"#FF0000"},{"answer":"B","weight":1,"color":"#0000FF"},{"answer":"C","weight":1,"color":"#FFFF00"},{"answer":"D","weight":1,"color":"#00FF00"}]', 0, 0, 1, 1, 1);

CREATE TABLE IF NOT EXISTS "digipog_pools" (
    "id" INTEGER NOT NULL UNIQUE,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT 'None',
    "amount" INTEGER NOT NULL DEFAULT 0,
    share_item INTEGER DEFAULT NULL,
    pin,
    PRIMARY KEY ("id" AUTOINCREMENT)
);

CREATE TABLE IF NOT EXISTS "exchanges" (
    "id" INTEGER NOT NULL UNIQUE,
    "from_user_id" INTEGER,
    "from_id" INTEGER,
    "from_type" TEXT,
    "offer" TEXT,
    "to_user_id" INTEGER,
    "to_id" INTEGER,
    "to_type" TEXT,
    "request" TEXT,
    "reason" TEXT,
    "status" TEXT,
    "failure_reason" TEXT,
    "created_at" TEXT,
    "updated_at" TEXT,
    PRIMARY KEY ("id" AUTOINCREMENT)
);

CREATE TABLE IF NOT EXISTS "inventory" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0)
);

CREATE TABLE IF NOT EXISTS "ip_access_list" (
    "id" INTEGER NOT NULL UNIQUE,
    "ip" TEXT NOT NULL,
    "is_whitelist" INTEGER NOT NULL CHECK ("is_whitelist" IN (0, 1)),
    PRIMARY KEY ("id" AUTOINCREMENT)
);

CREATE TABLE IF NOT EXISTS "item_registry" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    stack_size INTEGER NOT NULL DEFAULT 1 CHECK (stack_size >= 0),
    image_url TEXT
);

CREATE TABLE IF NOT EXISTS "links" (
    "id" INTEGER NOT NULL UNIQUE,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "classId" INTEGER NOT NULL,
    PRIMARY KEY ("id" AUTOINCREMENT)
);

CREATE TABLE IF NOT EXISTS "notifications" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    data TEXT,
    is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS "oauth_grants" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    app_id INTEGER NOT NULL,
    scopes TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    revoked_at INTEGER,
    UNIQUE (user_id, app_id)
);

CREATE TABLE IF NOT EXISTS "poll_answers" (
    pollId INTEGER NOT NULL,
    classId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    responseIds TEXT,
    buttonResponse TEXT,
    textResponse TEXT,
    createdAt INTEGER,
    PRIMARY KEY (userId, pollId)
);

CREATE TABLE IF NOT EXISTS "poll_history" (
    "id" INTEGER NOT NULL UNIQUE,
    "class" INTEGER NOT NULL,
    "prompt" TEXT,
    "responses" TEXT,
    "allowMultipleResponses" INTEGER NOT NULL DEFAULT 0,
    "blind" INTEGER NOT NULL DEFAULT 0,
    "allowTextResponses" INTEGER NOT NULL DEFAULT 0,
    "createdAt" INTEGER NOT NULL,
    "auto_end_timer" INTEGER,
    "auto_end_threshold" INTEGER,
    "blind_until_ended" INTEGER NOT NULL DEFAULT 0 CHECK ("blind_until_ended" IN (0, 1)),
    promptMD TEXT,
    promptHTML TEXT,
    PRIMARY KEY ("id" AUTOINCREMENT)
);

CREATE TABLE IF NOT EXISTS "refresh_tokens" (
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    exp INTEGER NOT NULL,
    token_type TEXT NOT NULL DEFAULT 'auth'
);

CREATE TABLE IF NOT EXISTS "roles" (
    "id" INTEGER NOT NULL UNIQUE,
    "name" TEXT NOT NULL,
    "isDefault" INTEGER NOT NULL DEFAULT 0,
    "scopes" TEXT NOT NULL DEFAULT '[]',
    "color" TEXT NOT NULL DEFAULT '#808080',
    PRIMARY KEY ("id" AUTOINCREMENT)
);

CREATE TABLE IF NOT EXISTS "shared_polls" (
    "pollId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "temp_user_creation_data" (
    "token" TEXT NOT NULL UNIQUE,
    "secret" TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS "trades" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user INTEGER NOT NULL,
    to_user INTEGER NOT NULL,
    from_source_type TEXT NOT NULL DEFAULT 'inventory' CHECK (from_source_type IN ('inventory', 'pool')),
    from_pool_id INTEGER,
    to_source_type TEXT NOT NULL DEFAULT 'inventory' CHECK (to_source_type IN ('inventory', 'pool')),
    to_pool_id INTEGER,
    offered_items TEXT,
    requested_items TEXT,
    offered_digipogs INTEGER,
    requested_digipogs INTEGER,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'rejected', 'canceled', 'failed')),
    failure_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "transactions" (
    "from_id" INTEGER NOT NULL,
    "to_id" INTEGER NOT NULL,
    "from_type" TEXT NOT NULL,
    "to_type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'None',
    "date" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "user_roles" (
    "userId" INTEGER NOT NULL,
    "roleId" INTEGER NOT NULL,
    "classId" INTEGER
);

CREATE TABLE IF NOT EXISTS "user_tokens" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    purpose TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    pool_id INTEGER
);

CREATE TABLE IF NOT EXISTS "users" (
    id INTEGER NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password TEXT,
    API TEXT UNIQUE,
    secret TEXT NOT NULL UNIQUE,
    digipogs INTEGER NOT NULL DEFAULT 0,
    pin TEXT,
    displayName TEXT,
    verified INTEGER NOT NULL DEFAULT 0,
    pog_meter INTEGER NOT NULL DEFAULT 0 CHECK (pog_meter >= 0),
    PRIMARY KEY (id AUTOINCREMENT)
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_api_keys_entity" ON "api_keys" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "idx_app_redirect_uris_app" ON "app_redirect_uris" ("app_id");
CREATE INDEX IF NOT EXISTS "idx_class_roles_classId" ON "class_roles" ("classId");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_class_roles_unique" ON "class_roles" ("classId", "roleId");
CREATE INDEX IF NOT EXISTS "idx_classroom_key" ON "classroom" ("key");
CREATE INDEX IF NOT EXISTS "idx_classroom_owner" ON "classroom" ("owner");
CREATE INDEX IF NOT EXISTS "idx_classusers_class_student" ON "classusers" ("classId", "studentId");
CREATE INDEX IF NOT EXISTS "idx_classusers_student_class" ON "classusers" ("studentId", "classId");
CREATE INDEX IF NOT EXISTS "idx_custom_polls_owner" ON "custom_polls" ("owner");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_display_name_unique" ON "users" ("displayName");
CREATE INDEX IF NOT EXISTS "idx_links_class_id" ON "links" ("classId");
CREATE INDEX IF NOT EXISTS "idx_notifications_user_id" ON "notifications" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_notifications_user_read" ON "notifications" ("user_id", "is_read");
CREATE INDEX IF NOT EXISTS "idx_oauth_grants_app" ON "oauth_grants" ("app_id");
CREATE INDEX IF NOT EXISTS "idx_oauth_grants_user_app" ON "oauth_grants" ("user_id", "app_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_refresh_token_hash_unique" ON "refresh_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_type" ON "refresh_tokens" ("token_type");
CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_user_type" ON "refresh_tokens" ("user_id", "token_type");
CREATE INDEX IF NOT EXISTS "idx_trades_from_user" ON "trades" ("from_user");
CREATE INDEX IF NOT EXISTS "idx_trades_from_user_status" ON "trades" ("from_user", "status");
CREATE INDEX IF NOT EXISTS "idx_trades_status" ON "trades" ("status");
CREATE INDEX IF NOT EXISTS "idx_trades_to_user" ON "trades" ("to_user");
CREATE INDEX IF NOT EXISTS "idx_trades_to_user_status" ON "trades" ("to_user", "status");
CREATE INDEX IF NOT EXISTS "idx_transactions_from_account_date" ON "transactions" ("from_type", "from_id", "date" DESC);
CREATE INDEX IF NOT EXISTS "idx_transactions_to_account_date" ON "transactions" ("to_type", "to_id", "date" DESC);
CREATE INDEX IF NOT EXISTS "idx_user_roles_class_user" ON "user_roles" ("classId", "userId");
CREATE INDEX IF NOT EXISTS "idx_user_roles_role_class" ON "user_roles" ("roleId", "classId");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_roles_unique" ON "user_roles" ("userId", "roleId", COALESCE("classId", -1));
CREATE INDEX IF NOT EXISTS "idx_user_roles_user_class" ON "user_roles" ("userId", "classId");
CREATE INDEX IF NOT EXISTS "idx_user_tokens_expires" ON "user_tokens" ("expires_at");
CREATE INDEX IF NOT EXISTS "idx_user_tokens_purpose_hash" ON "user_tokens" ("purpose", "token_hash");
CREATE INDEX IF NOT EXISTS "idx_user_tokens_user_purpose" ON "user_tokens" ("user_id", "purpose");

CREATE TABLE IF NOT EXISTS "schema_migrations_v2" (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
);

INSERT INTO "schema_migrations_v2" (name, applied_at) VALUES
    ('01_normalize_legacy_schema', datetime('now')),
    ('03_polls_and_transactions', datetime('now')),
    ('04_features_and_tokens', datetime('now')),
    ('05_finalize_v3', datetime('now'));
