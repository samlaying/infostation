import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Node 内置 SQLite（node:sqlite，Node >= 22.5），零原生编译依赖
export const db = new DatabaseSync(path.join(DATA_DIR, 'infostation.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS items (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  summary             TEXT NOT NULL DEFAULT '',
  key_points          TEXT NOT NULL DEFAULT '[]',   -- JSON string[]
  full_content        TEXT NOT NULL DEFAULT '',
  raw_input           TEXT NOT NULL DEFAULT '{}',   -- JSON RawInput
  primary_category    TEXT NOT NULL DEFAULT 'archive',
  secondary_category  TEXT NOT NULL DEFAULT 'insight',
  content_type        TEXT NOT NULL DEFAULT 'insight',
  tags                TEXT NOT NULL DEFAULT '[]',   -- JSON string[]
  priority            TEXT NOT NULL DEFAULT 'medium',
  source_type         TEXT NOT NULL DEFAULT 'text',
  source_platform     TEXT NOT NULL DEFAULT 'manual',
  source_url          TEXT,
  source_author       TEXT,
  agent_confidence    REAL NOT NULL DEFAULT 0.8,
  agent_note          TEXT,
  created_at          TEXT NOT NULL,
  processed_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS todos (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  source_item_id     TEXT REFERENCES items(id) ON DELETE CASCADE,
  source_summary     TEXT NOT NULL DEFAULT '',
  category           TEXT NOT NULL DEFAULT 'growth',
  priority           TEXT NOT NULL DEFAULT 'medium',
  status             TEXT NOT NULL DEFAULT 'pending',
  suggested_deadline TEXT,
  actual_deadline    TEXT,
  tags               TEXT NOT NULL DEFAULT '[]',    -- JSON string[]
  created_at         TEXT NOT NULL,
  completed_at       TEXT
);

CREATE TABLE IF NOT EXISTS item_relations (
  id             TEXT PRIMARY KEY,
  item_id        TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  related_item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  relation_type  TEXT NOT NULL DEFAULT 'same_topic',
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weekly_reports (
  id          TEXT PRIMARY KEY,
  week_start  TEXT NOT NULL UNIQUE,
  snapshot    TEXT NOT NULL,      -- JSON
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_created    ON items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_category   ON items(primary_category);
CREATE INDEX IF NOT EXISTS idx_todos_status     ON todos(status);
CREATE INDEX IF NOT EXISTS idx_todos_category   ON todos(category);
CREATE INDEX IF NOT EXISTS idx_todos_deadline   ON todos(actual_deadline);
CREATE INDEX IF NOT EXISTS idx_relations_item   ON item_relations(item_id);
`);

// ===== 事务包装（node:sqlite 无内建 transaction 助手）=====
export function transaction(fn) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
}

// ===== JSON 字段序列化助手 =====
export function rowToItem(row) {
  if (!row) return null;
  return {
    ...row,
    key_points: JSON.parse(row.key_points || '[]'),
    tags: JSON.parse(row.tags || '[]'),
    raw_input: JSON.parse(row.raw_input || '{}'),
  };
}

export function rowToTodo(row) {
  if (!row) return null;
  return {
    ...row,
    tags: JSON.parse(row.tags || '[]'),
  };
}

export function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(value));
}
