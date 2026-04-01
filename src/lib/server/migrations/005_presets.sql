CREATE TABLE IF NOT EXISTS presets (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    system_prompt TEXT,
    temperature REAL,
    top_p REAL,
    top_k INTEGER,
    min_p REAL,
    repeat_penalty REAL,
    thinking_budget INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
