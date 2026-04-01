import { Database } from 'bun:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { applyMigrations } from 'migralite';

const DATA_DIR = join(homedir(), '.local', 'share', 'lmux');
const DB_PATH = join(DATA_DIR, 'lmux.db');
const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations');

function ensureDir(dir: string) {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

async function createDatabase(): Promise<Database> {
	ensureDir(DATA_DIR);
	const db = new Database(DB_PATH, { create: true });
	db.run('PRAGMA journal_mode = WAL');
	db.run('PRAGMA foreign_keys = ON');
	await applyMigrations(db, MIGRATIONS_DIR);
	return db;
}

let _db: Database | null = null;

export async function initDb(): Promise<void> {
	if (!_db) {
		_db = await createDatabase();
	}
}

export function getDb(): Database {
	if (!_db) {
		throw new Error('Database not initialized. Call initDb() first.');
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
