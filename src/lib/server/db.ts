import { Database } from 'bun:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DATA_DIR = join(homedir(), '.local', 'share', 'lmux');
const DB_PATH = join(DATA_DIR, 'lmux.db');

function ensureDir(dir: string) {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

function createDatabase(): Database {
	ensureDir(DATA_DIR);
	const db = new Database(DB_PATH, { create: true });
	db.run('PRAGMA journal_mode = WAL');
	db.run('PRAGMA foreign_keys = ON');
	runMigrations(db);
	return db;
}

function runMigrations(db: Database) {
	db.run(`
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
		)
	`);

	db.run(`
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
		)
	`);

	db.run(`
		CREATE TABLE IF NOT EXISTS conversations (
			id INTEGER PRIMARY KEY,
			title TEXT,
			model_id INTEGER REFERENCES models(id) ON DELETE SET NULL,
			created_at TEXT DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT DEFAULT CURRENT_TIMESTAMP
		)
	`);

	db.run(`
		CREATE TABLE IF NOT EXISTS messages (
			id INTEGER PRIMARY KEY,
			conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
			role TEXT NOT NULL,
			content TEXT NOT NULL,
			token_count INTEGER,
			created_at TEXT DEFAULT CURRENT_TIMESTAMP
		)
	`);

	db.run(`
		CREATE TABLE IF NOT EXISTS hardware_cache (
			id INTEGER PRIMARY KEY,
			data TEXT NOT NULL,
			detected_at TEXT DEFAULT CURRENT_TIMESTAMP
		)
	`);

	db.run(`
		CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)
	`);

	db.run(`
		CREATE TABLE IF NOT EXISTS sampling_params (
			id INTEGER PRIMARY KEY,
			model_id INTEGER NOT NULL UNIQUE REFERENCES models(id) ON DELETE CASCADE,
			temperature REAL,
			top_p REAL,
			top_k INTEGER,
			min_p REAL,
			repeat_penalty REAL,
			source TEXT DEFAULT 'default'
		)
	`);
}

let _db: Database | null = null;

export function getDb(): Database {
	if (!_db) {
		_db = createDatabase();
	}
	return _db;
}

type Params = Record<string, string | number | boolean | null>;

export function queryAll<T>(sql: string, params: Params = {}): T[] {
	return getDb().prepare(sql).all(params) as T[];
}

export function queryOne<T>(sql: string, params: Params = {}): T | null {
	return (getDb().prepare(sql).get(params) as T) ?? null;
}

export function execute(sql: string, params: Params = {}) {
	return getDb().prepare(sql).run(params);
}
