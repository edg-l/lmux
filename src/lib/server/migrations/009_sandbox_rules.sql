CREATE TABLE sandbox_writable_paths (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime())
);

CREATE TABLE approved_commands (
    id INTEGER PRIMARY KEY,
    pattern TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime())
);
