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
  assigned_agent     TEXT,                          -- v2.3 承接人：null/user=本人 | search_agent | local_agent | content_agent
  step_order         INTEGER NOT NULL DEFAULT 0,    -- v2.3 同卡步骤序（决定派工就绪顺序）
  acceptance         TEXT NOT NULL DEFAULT '',      -- v2.3 验收标准（做到什么算完成）
  auto_status        TEXT NOT NULL DEFAULT '',      -- v2.3 agent 执行态：''|dispatched|running|done|failed|skipped
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
-- v2.3：status 不再设 DB CHECK（SQLite 无法 ALTER，状态权威在 constants.js），
--       新增 awaiting_user（确认门）与 todo_id（TODO 派发的 job 关联源 TODO）。
CREATE TABLE IF NOT EXISTS agent_jobs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id      TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  todo_id      TEXT REFERENCES todos(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',
  current_step TEXT,             -- 展示用："正在调用 ego 浏览器截图…"
  skills_plan  TEXT NOT NULL DEFAULT '[]',  -- JSON: [{skill, params, runtime: server|local, needs_confirm?, reason}]
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
// ===== v2.3：todos 智能派工四列 =====
if (addColumnIfMissing('todos', 'assigned_agent', 'TEXT')) migrated.push('todos.assigned_agent');
if (addColumnIfMissing('todos', 'step_order', 'INTEGER NOT NULL DEFAULT 0')) migrated.push('todos.step_order');
if (addColumnIfMissing('todos', 'acceptance', "TEXT NOT NULL DEFAULT ''")) migrated.push('todos.acceptance');
if (addColumnIfMissing('todos', 'auto_status', "TEXT NOT NULL DEFAULT ''")) migrated.push('todos.auto_status');
if (addColumnIfMissing('agent_jobs', 'todo_id', 'TEXT REFERENCES todos(id) ON DELETE CASCADE')) migrated.push('agent_jobs.todo_id');
if (migrated.length) console.log(`[db] 已补充列: ${migrated.join(', ')}`);

// ===== v2.3：agent_jobs 一次性表重建 =====
// 旧表 status 带 CHECK（不含 awaiting_user），SQLite 无法 ALTER CHECK，
// 检测到旧结构则事务内重建为无 CHECK 版本（状态权威挪到 constants.js）。
const jobsDdl = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_jobs'`).get();
if (jobsDdl && /CHECK\s*\(\s*status/i.test(jobsDdl.sql || '')) {
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE agent_jobs_rebuild (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id      TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        todo_id      TEXT REFERENCES todos(id) ON DELETE CASCADE,
        status       TEXT NOT NULL DEFAULT 'pending',
        current_step TEXT,
        skills_plan  TEXT NOT NULL DEFAULT '[]',
        logs         TEXT NOT NULL DEFAULT '[]',
        error_msg    TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO agent_jobs_rebuild (id, item_id, todo_id, status, current_step, skills_plan, logs, error_msg, created_at, updated_at)
        SELECT id, NULL, NULL, status, current_step, skills_plan, logs, error_msg, created_at, updated_at FROM agent_jobs;
      DROP TABLE agent_jobs;
      ALTER TABLE agent_jobs_rebuild RENAME TO agent_jobs;
    `);
    db.exec('COMMIT');
    console.log('[db] agent_jobs 已重建：status 去 CHECK（新增 awaiting_user），补 todo_id 列');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

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
CREATE INDEX IF NOT EXISTS idx_jobs_todo        ON agent_jobs(todo_id);
CREATE INDEX IF NOT EXISTS idx_todos_agent      ON todos(assigned_agent);
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
