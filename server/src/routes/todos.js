// ===== /api/v1/todos — TODO 管理 =====

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db, rowToTodo, rowToItem } from '../db.js';
import { isValidCategory, isValidPriority, isValidTodoStatus, isValidLine } from '../constants.js';
import { broadcast } from '../services/events.js';

export const todosRouter = Router();

// ---- 列表（视图筛选：today / goal / all / done）----
todosRouter.get('/todos', (req, res) => {
  const { view, category, priority, status, source_item_id, line, topic_id } = req.query;
  const where = [];
  const params = {};

  if (isValidCategory(category)) { where.push('category = @category'); params.category = category; }
  if (isValidPriority(priority)) { where.push('priority = @priority'); params.priority = priority; }
  if (isValidTodoStatus(status)) { where.push('status = @status'); params.status = status; }
  if (isValidLine(line)) { where.push('line = @line'); params.line = line; }
  if (source_item_id) { where.push('source_item_id = @sid'); params.sid = source_item_id; }
  if (topic_id) { where.push('topic_id = @topic_id'); params.topic_id = Number(topic_id); }

  const today = new Date().toISOString().slice(0, 10);
  if (view === 'today') {
    where.push(`status IN ('pending','in_progress')`);
    where.push(`(date(actual_deadline) IS NULL OR date(actual_deadline) <= date(@today) OR date(suggested_deadline) <= date(@today))`);
    params.today = today;
  } else if (view === 'pending') {
    where.push(`status IN ('pending','in_progress')`);
  } else if (view === 'done') {
    where.push(`status = 'done'`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT * FROM todos ${whereSql}
       ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                CASE status WHEN 'in_progress' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                actual_deadline IS NULL, actual_deadline, created_at DESC`
    )
    .all(params);

  const items = db.prepare('SELECT id, title FROM items').all().reduce((m, r) => ((m[r.id] = r.title), m), {});
  // today_summary 跟随 line 过滤：两条线要能各自看到自己的计数
  const summaryLine = isValidLine(line) ? line : null;
  const lineClause = summaryLine ? ' AND line = ?' : '';
  const lineArg = summaryLine ? [summaryLine] : [];
  res.json({
    todos: rows.map((r) => ({ ...rowToTodo(r), source_item_title: items[r.source_item_id] || null })),
    today_summary: {
      date: today,
      line: summaryLine,
      pending_count: db
        .prepare(`SELECT COUNT(*) c FROM todos WHERE status IN ('pending','in_progress')${lineClause}`)
        .get(...lineArg).c,
      today_due_count: db
        .prepare(
          `SELECT COUNT(*) c FROM todos WHERE status IN ('pending','in_progress')
           AND (date(actual_deadline) <= date(?) OR (actual_deadline IS NULL AND date(suggested_deadline) <= date(?)))${lineClause}`
        )
        .get(today, today, ...lineArg).c,
    },
  });
});

// ---- 手动新建 ----
todosRouter.post('/todos', (req, res) => {
  const { title, description = '', category = 'growth', priority = 'medium', actual_deadline, source_item_id, line, topic_id } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'TODO 标题不能为空' });
  if (source_item_id && !db.prepare('SELECT id FROM items WHERE id = ?').get(source_item_id)) {
    return res.status(400).json({ error: '来源信息不存在' });
  }
  // v2.1：手动 TODO 可直挂主题（TODO 面板快速添加绑主题）
  let topicId = null;
  if (Number.isFinite(Number(topic_id))) {
    const t = db.prepare('SELECT id FROM topics WHERE id = ?').get(Number(topic_id));
    if (!t) return res.status(400).json({ error: '主题不存在' });
    topicId = t.id;
  }
  const now = new Date().toISOString();
  const id = nanoid();
  // 显式传 line 优先；否则继承来源卡片的线；再否则默认 trial
  let targetLine = isValidLine(line) ? line : null;
  if (!targetLine && source_item_id) {
    const src = db.prepare('SELECT line FROM items WHERE id = ?').get(source_item_id);
    if (src && isValidLine(src.line)) targetLine = src.line;
  }
  db.prepare(`
    INSERT INTO todos (id, title, description, source_item_id, category, priority, status, actual_deadline, tags, line, topic_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, '[]', ?, ?, ?)
  `).run(
    id,
    String(title).trim().slice(0, 40),
    String(description).slice(0, 300),
    source_item_id || null,
    isValidCategory(category) ? category : 'growth',
    isValidPriority(priority) ? priority : 'medium',
    actual_deadline || null,
    targetLine || 'trial',
    topicId,
    now
  );
  broadcast('todos', 'create', id);
  res.status(201).json(rowToTodo(db.prepare('SELECT * FROM todos WHERE id = ?').get(id)));
});

// ---- 更新（状态/编辑/截止日期）----
todosRouter.patch('/todos/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'TODO 不存在' });

  const b = req.body || {};
  const updates = {};
  if (typeof b.title === 'string' && b.title.trim()) updates.title = b.title.trim().slice(0, 40);
  if (typeof b.description === 'string') updates.description = b.description.slice(0, 300);
  if (isValidCategory(b.category)) updates.category = b.category;
  if (isValidPriority(b.priority)) updates.priority = b.priority;
  if (isValidLine(b.line)) updates.line = b.line;
  if (typeof b.actual_deadline === 'string' || b.actual_deadline === null) updates.actual_deadline = b.actual_deadline || null;
  if (isValidTodoStatus(b.status)) {
    updates.status = b.status;
    updates.completed_at = b.status === 'done' ? new Date().toISOString() : null;
  }

  if (!Object.keys(updates).length) return res.status(400).json({ error: '没有可更新的字段' });

  const setSql = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE todos SET ${setSql} WHERE id = @id`).run({ ...updates, id: req.params.id });
  broadcast('todos', 'update', req.params.id);
  res.json(rowToTodo(db.prepare('SELECT * FROM todos WHERE id = ?').get(req.params.id)));
});

// ---- 删除 ----
todosRouter.delete('/todos/:id', (req, res) => {
  const info = db.prepare('DELETE FROM todos WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'TODO 不存在' });
  broadcast('todos', 'delete', req.params.id);
  res.json({ ok: true });
});
