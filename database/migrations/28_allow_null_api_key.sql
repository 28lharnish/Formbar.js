-- 28_allow_null_api_key
-- Allows null API keys while keeping API values unique for indexed lookups.

ALTER TABLE users RENAME TO users_temp;

CREATE TABLE users (
    id INTEGER NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password TEXT,
    API TEXT UNIQUE,
    secret TEXT NOT NULL UNIQUE,
    tags TEXT,
    digipogs INTEGER NOT NULL DEFAULT 0,
    pin TEXT,
    displayName TEXT,
    verified INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id AUTOINCREMENT)
);

INSERT INTO users (id, email, password, API, secret, tags, digipogs, pin, displayName, verified)
SELECT id, email, password, API, secret, tags, digipogs, pin, displayName, verified
FROM users_temp;

DROP TABLE users_temp;

CREATE UNIQUE INDEX IF NOT EXISTS idx_display_name_unique ON users (displayName);
