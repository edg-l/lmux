CREATE TABLE approval_history (
    id INTEGER PRIMARY KEY,
    command TEXT NOT NULL,
    result TEXT NOT NULL CHECK (result IN ('approved', 'denied', 'timeout')),
    created_at TEXT NOT NULL DEFAULT (datetime())
);
CREATE INDEX idx_approval_history_command ON approval_history(command);
