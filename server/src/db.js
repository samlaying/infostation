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
  line                TEXT NOT NULL DEFAULT 'trial',  -- 产品线：trial(TODO线) | media(自媒体线)
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
  line               TEXT NOT NULL DEFAULT 'trial', -- 产品线：trial(行动项) | media(内容工序)
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

-- ===== v2.0：主题/目标（一等公民，取代 category 枚举 + localStorage 主题）=====
CREATE TABLE IF NOT EXISTS topics (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL UNIQUE,
  slug         TEXT UNIQUE,
  icon         TEXT DEFAULT '📁',
  color        TEXT DEFAULT '#6366f1',
  default_line TEXT NOT NULL DEFAULT 'trial' CHECK(default_line IN ('trial', 'media')),
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
  sort_order   INTEGER DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== v2.0：媒体资产（Agent 浏览器截图 / 生图 / 上传图床）=====
-- 注意 items.id 是 TEXT(nanoid)，因此这里的 FK 也必须是 TEXT
CREATE TABLE IF NOT EXISTS assets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  todo_id     TEXT REFERENCES todos(id) ON DELETE SET NULL,
  asset_type  TEXT NOT NULL CHECK(asset_type IN ('screenshot', 'ai_image', 'upload', 'video')),
  local_path  TEXT,
  remote_url  TEXT,
  source_url  TEXT,
  prompt      TEXT,
  metadata    TEXT DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== v2.0：帖子产出（多平台发布内容与回执）=====
CREATE TABLE IF NOT EXISTS posts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_item_id  TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  topic_id        INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  platform        TEXT NOT NULL DEFAULT 'xiaohongshu',
  title           TEXT NOT NULL,
  content_body    TEXT NOT NULL,
  asset_ids       TEXT DEFAULT '[]',
  status          TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'ready', 'publishing', 'published', 'failed')),
  published_url   TEXT,
  published_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== v2.2：Agent 预处理任务（Pre-execution Engine）=====
-- 卡片入库后由 orchestrator 生成技能执行计划；重型技能（浏览器截图/gh clone）
-- 没有部署在生产 VPS 上，标记 runtime='local'，由用户 Mac 上的 CLI worker
-- 通过 REST 认领执行、回传产物（截图上传为静态文件并登记 assets）。
CREATE TABLE IF NOT EXISTS agent_jobs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id      TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK(status IN ('pending', 'running', 'waiting_local', 'completed', 'failed')),
  current_step TEXT,             -- 展示用："正在调用 ego 浏览器截图…"
  skills_plan  TEXT NOT NULL DEFAULT '[]',  -- JSON: [{skill, params, runtime: server|local, reason}]
  logs         TEXT NOT NULL DEFAULT '[]',  -- JSON: [{skill, status, result, error, started_at, finished_at}]
  error_msg    TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
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

// ===== 幂等迁移 =====
// CREATE TABLE IF NOT EXISTS 不会给已存在的表加列。本项目无迁移框架，
// 用 PRAGMA table_info 检测缺列后 ALTER TABLE 补上（重复执行安全）。
function addColumnIfMissing(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

const migrated = [];
if (addColumnIfMissing('items', 'line', "TEXT NOT NULL DEFAULT 'trial'")) migrated.push('items.line');
if (addColumnIfMissing('todos', 'line', "TEXT NOT NULL DEFAULT 'trial'")) migrated.push('todos.line');
// ===== v2.0：items 升级（主题归属 / 卡片角色 / 父子血缘 / 更新时间）=====
if (addColumnIfMissing('items', 'topic_id', 'INTEGER REFERENCES topics(id) ON DELETE SET NULL')) migrated.push('items.topic_id');
if (addColumnIfMissing('items', 'item_type', "TEXT NOT NULL DEFAULT 'material'")) migrated.push('items.item_type');
if (addColumnIfMissing('items', 'parent_item_id', 'TEXT REFERENCES items(id) ON DELETE SET NULL')) migrated.push('items.parent_item_id');
if (addColumnIfMissing('items', 'updated_at', "TEXT NOT NULL DEFAULT ''")) migrated.push('items.updated_at');
if (addColumnIfMissing('todos', 'topic_id', 'INTEGER REFERENCES topics(id) ON DELETE SET NULL')) migrated.push('todos.topic_id');
if (addColumnIfMissing('todos', 'updated_at', "TEXT NOT NULL DEFAULT ''")) migrated.push('todos.updated_at');
if (migrated.length) console.log(`[db] 已补充列: ${migrated.join(', ')}`);

// 存量行 updated_at 为空串，回填为 created_at
db.exec(`UPDATE items SET updated_at = created_at WHERE updated_at = ''`);
db.exec(`UPDATE todos SET updated_at = created_at WHERE updated_at = ''`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_items_line       ON items(line);
CREATE INDEX IF NOT EXISTS idx_todos_line       ON todos(line);
CREATE INDEX IF NOT EXISTS idx_items_topic      ON items(topic_id);
CREATE INDEX IF NOT EXISTS idx_items_type       ON items(item_type);
CREATE INDEX IF NOT EXISTS idx_items_parent     ON items(parent_item_id);
CREATE INDEX IF NOT EXISTS idx_todos_topic      ON todos(topic_id);
CREATE INDEX IF NOT EXISTS idx_assets_item      ON assets(item_id);
CREATE INDEX IF NOT EXISTS idx_posts_source     ON posts(source_item_id);
CREATE INDEX IF NOT EXISTS idx_posts_status     ON posts(status);
CREATE INDEX IF NOT EXISTS idx_jobs_item        ON agent_jobs(item_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status      ON agent_jobs(status);
`);

// ===== v2.0：触发器 —— 母卡 line/topic_id 变更时自动同步名下 todos（消灭漂移）=====
db.exec(`
CREATE TRIGGER IF NOT EXISTS trg_sync_item_to_todos
AFTER UPDATE OF line, topic_id ON items
BEGIN
    UPDATE todos
    SET line = NEW.line,
        topic_id = NEW.topic_id,
        updated_at = datetime('now')
    WHERE source_item_id = NEW.id;
END;
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

// ===== v2.0 行转换助手 =====
export function rowToTopic(row) {
  if (!row) return null;
  return { ...row };
}

export function rowToAsset(row) {
  if (!row) return null;
  return { ...row, metadata: JSON.parse(row.metadata || '{}') };
}

export function rowToPost(row) {
  if (!row) return null;
  return { ...row, asset_ids: JSON.parse(row.asset_ids || '[]') };
}

// ===== v2.2：预处理任务行转换 =====
export function rowToJob(row) {
  if (!row) return null;
  return { ...row, skills_plan: JSON.parse(row.skills_plan || '[]'), logs: JSON.parse(row.logs || '[]') };
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
