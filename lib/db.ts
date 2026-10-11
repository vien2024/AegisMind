import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  parent_id INTEGER,
  dedup_key TEXT UNIQUE NOT NULL,
  attributes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_scope (
  task_id INTEGER NOT NULL,
  asset_id INTEGER NOT NULL,
  PRIMARY KEY (task_id, asset_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  target TEXT NOT NULL,
  description TEXT,
  goal TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  language TEXT NOT NULL DEFAULT 'en',
  concurrency INTEGER NOT NULL DEFAULT 3,
  auto_approve INTEGER NOT NULL DEFAULT 1,
  todolist TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS exploration_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  data TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exploration_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  from_id INTEGER NOT NULL,
  to_id INTEGER NOT NULL,
  relation TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exploration_anchors (
  node_id INTEGER NOT NULL,
  asset_id INTEGER NOT NULL,
  PRIMARY KEY (node_id, asset_id)
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  intent_id INTEGER,
  step INTEGER,
  role TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  data TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  asset_id INTEGER,
  node_id INTEGER,
  title TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  description TEXT,
  evidence TEXT,
  disposition TEXT,
  fix_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  intent_id INTEGER,
  tool TEXT NOT NULL,
  args TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'auto_approved',
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS traffic (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  intent_id INTEGER,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  status INTEGER,
  request TEXT,
  response TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  base_url TEXT,
  api_key TEXT,
  temperature REAL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  role TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  live INTEGER NOT NULL DEFAULT 1,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assets_company ON assets(company_id);
CREATE INDEX IF NOT EXISTS idx_assets_parent ON assets(parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_task ON exploration_nodes(task_id, kind);
CREATE INDEX IF NOT EXISTS idx_edges_task ON exploration_edges(task_id);
CREATE INDEX IF NOT EXISTS idx_activity_task ON activity(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_traffic_task ON traffic(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_findings_task ON findings(task_id);
CREATE INDEX IF NOT EXISTS idx_usage_created ON llm_usage(created_at);
`;

const globalForDb = globalThis as unknown as { __aegismind_db?: Database.Database };

/** Database file for this installation, shared by the DB layer and the Storage card. */
export function resolveDbPath(): string {
  const explicit = process.env.AEGISMIND_DB ?? process.env.SCOPEWEAVER_DB;
  if (explicit) return explicit;

  const current = path.join(process.cwd(), "data", "aegismind.db");
  // An upgrade from a pre-rename install keeps its existing file (and account).
  const PREVIOUS_DB_FILE = ["scopeweaver", "db"].join(".");
  const legacy = path.join(process.cwd(), "data", PREVIOUS_DB_FILE);
  if (!fs.existsSync(current) && fs.existsSync(legacy)) return legacy;
  return current;
}

export function db(): Database.Database {
  if (globalForDb.__aegismind_db) return globalForDb.__aegismind_db;

  const file = resolveDbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const database = new Database(file);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.exec(SCHEMA);

  globalForDb.__aegismind_db = database;
  return database;
}

export function now(): string {
  return new Date().toISOString();
}

export function getSetting(key: string): string | null {
  const row = db()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
