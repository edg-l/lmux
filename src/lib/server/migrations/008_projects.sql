CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime())
);

ALTER TABLE conversations ADD COLUMN project_id INTEGER REFERENCES projects(id);
