// ===== /api/v1/topics — 主题/目标（v2.0 一等公民）=====
// 取代写死的 category 枚举与 localStorage 主题：一个 Topic = 一个长期领域/项目，
// 自带 default_line（决定该主题默认流水线），items/todos 直接挂载。

import { Router } from 'express';
import { db, rowToTopic } from '../db.js';
import { isValidLine } from '../constants.js';
import { broadcast } from '../services/events.js';

export const topicsRouter = Router();

// 列表（带卡片/任务计数与最近活跃时间，供 TopicDock 与「7 天荒废」提醒使用）
topicsRouter.get('/topics', (req, res) => {
  const { status } = req.query;
  const where = status === 'archived' || status === 'active' ? 'WHERE t.status = ?' : '';
  const params = where ? [status] : [];

  const rows = db
    .prepare(
      `
      SELECT t.*,
        (SELECT COUNT(*) FROM items i WHERE i.topic_id = t.id) AS item_count,
        (SELECT COUNT(*) FROM todos td WHERE td.topic_id = t.id) AS todo_count,
        (SELECT MAX(x) FROM (
           SELECT MAX(i.updated_at) AS x FROM items i WHERE i.topic_id = t.id
           UNION ALL
           SELECT MAX(td.updated_at) AS x FROM todos td WHERE td.topic_id = t.id
        )) AS last_active_at
      FROM topics t ${where}
      ORDER BY t.sort_order, t.id
      `
    )
    .all(...params)
    .map(rowToTopic);

  res.json({ topics: rows });
});

// 新建
topicsRouter.post('/topics', (req, res) => {
  const { name, icon = '📁', color = '#6366f1', default_line = 'trial', description = '', sort_order = 0 } =
    req.body || {};
  const n = String(name || '').trim();
  if (!n) return res.status(400).json({ error: '主题名不能为空' });
  if (db.prepare('SELECT id FROM topics WHERE name = ?').get(n)) {
    return res.status(409).json({ error: `主题「${n}」已存在` });
  }
  const slug = n
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '') || `topic-${Date.now()}`;

  const info = db
    .prepare(
      `INSERT INTO topics (name, slug, icon, color, default_line, description, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(n, slug, icon, color, isValidLine(default_line) ? default_line : 'trial', description, sort_order || 0);

  broadcast('topics', 'create');
  res.status(201).json(rowToTopic(db.prepare('SELECT * FROM topics WHERE id = ?').get(info.lastInsertRowid)));
});

// 更新（改名/图标/状态/排序/默认线）
topicsRouter.patch('/topics/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM topics WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: '主题不存在' });

  const b = req.body || {};
  const updates = {};
  if (typeof b.name === 'string' && b.name.trim()) updates.name = b.name.trim();
  if (typeof b.icon === 'string') updates.icon = b.icon;
  if (typeof b.color === 'string') updates.color = b.color;
  if (isValidLine(b.default_line)) updates.default_line = b.default_line;
  if (typeof b.description === 'string') updates.description = b.description;
  if (b.status === 'active' || b.status === 'archived') updates.status = b.status;
  if (Number.isFinite(Number(b.sort_order))) updates.sort_order = Number(b.sort_order);

  if (!Object.keys(updates).length) return res.status(400).json({ error: '没有可更新的字段' });

  const setSql = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE topics SET ${setSql}, updated_at = datetime('now') WHERE id = @id`).run({ ...updates, id });
  broadcast('topics', 'update', id);
  res.json(rowToTopic(db.prepare('SELECT * FROM topics WHERE id = ?').get(id)));
});

// 删除（items/todos.topic_id 为 SET NULL，不连累数据）
topicsRouter.delete('/topics/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM topics WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: '主题不存在' });
  db.prepare('DELETE FROM topics WHERE id = ?').run(id);
  broadcast('all', 'delete', id); // 挂在主题下的 items/todos.topic_id 全被置空，各视图都重拉
  res.json({ ok: true, deleted: existing.name });
});
