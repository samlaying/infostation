// ===== /api/v1/items — 知识卡片 CRUD + 筛选/搜索/排序 =====

import { Router } from 'express';
import { db, rowToItem, rowToTodo } from '../db.js';
import { isValidCategory, isValidContentType, isValidPriority, isValidLine, isValidItemType, CATEGORIES, CONTENT_TYPES, PRIORITIES, SOURCE_PLATFORMS } from '../constants.js';
import { broadcast } from '../services/events.js';

export const itemsRouter = Router();

// ---- 列表（筛选 + 搜索 + 排序 + 分页）----
itemsRouter.get('/items', (req, res) => {
  const {
    category,
    content_type,
    priority,
    platform,
    tag,
    has_todo,
    line,
    topic_id,
    item_type,
    form,
    parent_item_id,
    q,
    sort = 'time',
    page = '1',
    page_size = '24',
  } = req.query;

  const where = [];
  const params = {};

  if (isValidCategory(category)) { where.push('i.primary_category = @category'); params.category = category; }
  if (isValidContentType(content_type)) { where.push('i.content_type = @content_type'); params.content_type = content_type; }
  if (isValidPriority(priority)) { where.push('i.priority = @priority'); params.priority = priority; }
  if (isValidLine(line)) { where.push('i.line = @line'); params.line = line; }
  if (topic_id) { where.push('i.topic_id = @topic_id'); params.topic_id = Number(topic_id); }
  if (isValidItemType(item_type)) { where.push('i.item_type = @item_type'); params.item_type = item_type; }
  // v2.1 形态筛选（MECE 四形态）：link/note 拆分 material；idea/bundle 兼容旧 tags 打标的数据
  if (form === 'link') where.push("i.item_type = 'material' AND i.source_url IS NOT NULL");
  if (form === 'note') where.push("i.item_type = 'material' AND i.source_url IS NULL");
  if (form === 'idea') where.push("(i.item_type = 'idea' OR i.tags LIKE '%\"选题\"%')");
  if (form === 'bundle') where.push("(i.item_type = 'bundle' OR i.tags LIKE '%\"发布包\"%')");
  if (parent_item_id === 'none') { where.push('i.parent_item_id IS NULL'); }
  else if (parent_item_id) { where.push('i.parent_item_id = @parent'); params.parent = parent_item_id; }
  if (SOURCE_PLATFORMS.includes(platform)) { where.push('i.source_platform = @platform'); params.platform = platform; }
  if (tag) { where.push("i.tags LIKE @tag"); params.tag = `%"${String(tag).replace(/[%_"]/g, '')}"%`; }
  if (has_todo === 'yes') { where.push('EXISTS (SELECT 1 FROM todos t WHERE t.source_item_id = i.id)'); }
  if (has_todo === 'no') { where.push('NOT EXISTS (SELECT 1 FROM todos t WHERE t.source_item_id = i.id)'); }
  if (q) {
    const kw = `%${String(q).replace(/[%_]/g, '')}%`;
    where.push('(i.title LIKE @kw OR i.summary LIKE @kw OR i.full_content LIKE @kw OR i.tags LIKE @kw)');
    params.kw = kw;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderBy =
    sort === 'priority'
      ? `CASE i.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, i.created_at DESC`
      : sort === 'related'
        ? '(SELECT COUNT(*) FROM item_relations r WHERE r.item_id = i.id) DESC, i.created_at DESC'
        : 'i.created_at DESC';

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(60, Math.max(1, parseInt(page_size, 10) || 24));

  const total = db.prepare(`SELECT COUNT(*) AS c FROM items i ${whereSql}`).get(params).c;
  const rows = db
    .prepare(
      `SELECT i.*,
        t.name AS topic_name,
        (SELECT COUNT(*) FROM todos td WHERE td.source_item_id = i.id) AS todo_count,
        (SELECT COUNT(*) FROM todos td WHERE td.source_item_id = i.id AND td.status = 'done') AS todo_done_count,
        (SELECT COUNT(*) FROM item_relations r WHERE r.item_id = i.id) AS related_count,
        (SELECT COUNT(*) FROM assets a WHERE a.item_id = i.id) AS asset_count,
        (SELECT j.status FROM agent_jobs j WHERE j.item_id = i.id ORDER BY j.id DESC LIMIT 1) AS job_status,
        (SELECT j.current_step FROM agent_jobs j WHERE j.item_id = i.id ORDER BY j.id DESC LIMIT 1) AS job_step,
        (SELECT td.id FROM todos td WHERE td.source_item_id = i.id AND td.status IN ('pending','in_progress')
           ORDER BY CASE td.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, td.created_at LIMIT 1) AS next_todo_id,
        (SELECT td.title FROM todos td WHERE td.source_item_id = i.id AND td.status IN ('pending','in_progress')
           ORDER BY CASE td.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, td.created_at LIMIT 1) AS next_todo_title
       FROM items i LEFT JOIN topics t ON t.id = i.topic_id
       ${whereSql} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit: pageSize, offset: (pageNum - 1) * pageSize });

  res.json({
    total,
    page: pageNum,
    page_size: pageSize,
    items: rows.map(rowToItem),
  });
});

// ---- 详情 ----
itemsRouter.get('/items/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '信息不存在' });
  const todos = db.prepare('SELECT * FROM todos WHERE source_item_id = ?').all(req.params.id).map(rowToTodo);
  const assets = db
    .prepare('SELECT * FROM assets WHERE item_id = ? ORDER BY created_at DESC, id DESC')
    .all(req.params.id)
    .map((a) => ({ ...a, metadata: JSON.parse(a.metadata || '{}') }));
  const relatedRows = db
    .prepare(
      `SELECT i.id, i.title, i.primary_category, i.tags, r.relation_type
       FROM item_relations r JOIN items i ON i.id = r.related_item_id
       WHERE r.item_id = ?`
    )
    .all(req.params.id)
    .map((r) => ({ ...r, tags: JSON.parse(r.tags || '[]') }));
  res.json({ ...rowToItem(row), todos, assets, related_items: relatedRows });
});

// ---- 编辑（标题/分类/类型/标签/优先级/摘要）----
itemsRouter.patch('/items/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '信息不存在' });

  const b = req.body || {};
  const updates = {};
  if (typeof b.title === 'string' && b.title.trim()) updates.title = b.title.trim().slice(0, 60);
  if (typeof b.summary === 'string') updates.summary = b.summary.trim().slice(0, 300);
  // v2.2：要点数组支持就地编辑（Inspector 实时保存）
  if (Array.isArray(b.key_points)) {
    updates.key_points = JSON.stringify(
      b.key_points.map((k) => String(k).slice(0, 200)).filter(Boolean).slice(0, 12)
    );
  }
  if (isValidCategory(b.primary_category)) updates.primary_category = b.primary_category;
  if (isValidContentType(b.content_type)) { updates.content_type = b.content_type; updates.secondary_category = b.content_type; }
  if (isValidPriority(b.priority)) updates.priority = b.priority;
  if (isValidLine(b.line)) updates.line = b.line;
  if (Array.isArray(b.tags)) updates.tags = JSON.stringify(b.tags.map((t) => String(t).slice(0, 20)).slice(0, 8));
  if (typeof b.full_content === 'string') updates.full_content = b.full_content;
  // v2.0：主题归属 / 卡片角色 / 父子血缘
  if (b.topic_id === null) updates.topic_id = null;
  else if (Number.isFinite(Number(b.topic_id))) {
    if (!db.prepare('SELECT id FROM topics WHERE id = ?').get(Number(b.topic_id))) {
      return res.status(400).json({ error: '主题不存在' });
    }
    updates.topic_id = Number(b.topic_id);
  }
  if (isValidItemType(b.item_type)) updates.item_type = b.item_type;
  if (b.parent_item_id === null) updates.parent_item_id = null;
  else if (typeof b.parent_item_id === 'string' && b.parent_item_id !== req.params.id) {
    if (!db.prepare('SELECT id FROM items WHERE id = ?').get(b.parent_item_id)) {
      return res.status(400).json({ error: '父卡片不存在' });
    }
    updates.parent_item_id = b.parent_item_id;
  }

  if (!Object.keys(updates).length) return res.status(400).json({ error: '没有可更新的字段' });

  updates.updated_at = new Date().toISOString();
  const setSql = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE items SET ${setSql} WHERE id = @id`).run({ ...updates, id: req.params.id });
  broadcast('items', 'update', req.params.id);
  res.json(rowToItem(db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id)));
});

// ---- 删除（级联删 TODO/关联）----
itemsRouter.delete('/items/:id', (req, res) => {
  const info = db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: '信息不存在' });
  broadcast('items', 'delete', req.params.id);
  broadcast('todos', 'delete'); // 级联删了关联 TODO，TODO 视图需要重拉
  res.json({ ok: true });
});
