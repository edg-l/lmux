import { Database } from 'bun:sqlite';
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DATA_DIR = join(homedir(), '.local', 'share', 'lmux');
const DB_PATH = join(DATA_DIR, 'lmux.db');
const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations');

function ensureDir(dir: string) {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

function applyMigrationsSync(db: Database, migrationsDir: string): void {
	db.run(
		`CREATE TABLE IF NOT EXISTS __migrations__ (
			id INTEGER PRIMARY KEY,
			file_name TEXT NOT NULL UNIQUE,
			hash TEXT NOT NULL,
			executed_at TEXT NOT NULL DEFAULT (datetime())
		)`
	);

	const applied = new Map<string, string>();
	for (const row of db.prepare('SELECT file_name, hash FROM __migrations__').all() as {
		file_name: string;
		hash: string;
	}[]) {
		applied.set(row.file_name, row.hash);
	}

	const files = readdirSync(migrationsDir)
		.filter((f) => f.endsWith('.sql'))
		.sort();

	for (const fileName of files) {
		const content = readFileSync(join(migrationsDir, fileName), 'utf-8');
		const hash = Bun.hash(content).toString();

		if (applied.has(fileName)) {
			if (applied.get(fileName) !== hash) {
				throw new Error(`Migration hash mismatch for ${fileName}`);
			}
			continue;
		}

		db.transaction(() => {
			db.run(content);
			db.prepare('INSERT INTO __migrations__ (file_name, hash) VALUES (?, ?)').run(fileName, hash);
		})();
		console.info(`Migration applied: ${fileName}`);
	}
}

function createDatabase(): Database {
	ensureDir(DATA_DIR);
	const db = new Database(DB_PATH, { create: true });
	db.run('PRAGMA journal_mode = WAL');
	db.run('PRAGMA foreign_keys = ON');
	applyMigrationsSync(db, MIGRATIONS_DIR);
	return db;
}

let _db: Database | null = null;

export function initDb(): void {
	if (!_db) {
		_db = createDatabase();
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
