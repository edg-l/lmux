CREATE TABLE IF NOT EXISTS models (
    id INTEGER PRIMARY KEY,
    filename TEXT NOT NULL,
    filepath TEXT NOT NULL UNIQUE,
    size_bytes INTEGER,
    architecture TEXT,
    parameter_count INTEGER,
    quant_type TEXT,
    context_length INTEGER,
    block_count INTEGER,
    hf_repo TEXT,
    hf_filename TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    gpu_layers INTEGER,
    context_size INTEGER,
    port INTEGER DEFAULT 8080,
    threads INTEGER,
    batch_size INTEGER,
    flash_attn TEXT DEFAULT 'auto',
    kv_cache_type TEXT DEFAULT 'q8_0',
    extra_flags TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY,
    title TEXT,
    model_id INTEGER REFERENCES models(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hardware_cache (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    detected_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sampling_params (
    id INTEGER PRIMARY KEY,
    model_id INTEGER NOT NULL UNIQUE REFERENCES models(id) ON DELETE CASCADE,
    temperature REAL,
    top_p REAL,
    top_k INTEGER,
    min_p REAL,
    repeat_penalty REAL,
    source TEXT DEFAULT 'default'
);
