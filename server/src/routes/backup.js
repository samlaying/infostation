// ===== /api/v1/export | /api/v1/import — 数据导入导出 =====

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db, rowToItem, rowToTodo, transaction } from '../db.js';
import { isValidCategory, isValidPriority, isValidTodoStatus, isValidLine } from '../constants.js';
import { broadcast } from '../services/events.js';

export const backupRouter = Router();

// ---- JSON 全量导出 ----
backupRouter.get('/export', (req, res) => {
  const items = db.prepare('SELECT * FROM items ORDER BY created_at DESC').all().map(rowToItem);
  const todos = db.prepare('SELECT * FROM todos ORDER BY created_at DESC').all().map(rowToTodo);
  const settings = db.prepare('SELECT key, value FROM settings').all()
    .reduce((m, r) => { try { m[r.key] = JSON.parse(r.value); } catch {} return m; }, {});

  res.json({
    format: 'infostation-backup',
    version: 1,
    exported_at: new Date().toISOString(),
    items,
    todos,
    settings,
  });
});

// ---- Markdown 导出（知识归档）----
backupRouter.get('/export/markdown', (req, res) => {
  const items = db.prepare('SELECT * FROM items ORDER BY created_at DESC').all().map(rowToItem);
  const catLabels = {
    career: '职场提升', media: '自媒体', sidehustle: '副业',
    growth: '认知成长', tools: '工具推荐', archive: '存档',
  };
  const lines = [
    '# InfoStation 知识归档',
    '',
    `> 导出时间：${new Date().toISOString().slice(0, 10)} · 共 ${items.length} 条`,
    '',
  ];
  let lastCat = null;
  for (const it of items) {
    if (it.primary_category !== lastCat) {
      lastCat = it.primary_category;
      lines.push(`\n## ${catLabels[lastCat] || lastCat}\n`);
    }
    lines.push(`### ${it.title}`);
    lines.push(`> ${it.created_at.slice(0, 10)} · ${it.source_platform}${it.source_url ? ` · [原文链接](${it.source_url})` : ''}`);
    lines.push('');
    lines.push(it.summary);
    if (it.key_points?.length) {
      lines.push('');
      lines.push('**关键要点**');
      for (const k of it.key_points) lines.push(`- ${k}`);
    }
    if (it.tags?.length) lines.push(`\n标签：${it.tags.map((t) => `#${t}`).join(' ')}`);
    lines.push('\n---\n');
  }
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="infostation-${new Date().toISOString().slice(0, 10)}.md"`);
  res.send(lines.join('\n'));
});

// ---- JSON 导入（合并，不去重覆盖）----
backupRouter.post('/import', (req, res) => {
  const payload = req.body;
  if (!payload || payload.format !== 'infostation-backup' || !Array.isArray(payload.items)) {
    return res.status(400).json({ error: '文件格式不正确，需要 InfoStation 导出的 JSON 备份' });
  }

  const now = new Date().toISOString();
  let itemsCount = 0;
  let todosCount = 0;

  const insertItem = db.prepare(`
    INSERT OR IGNORE INTO items (id, title, summary, key_points, full_content, raw_input,
      primary_category, secondary_category, content_type, tags, priority,
      source_type, source_platform, source_url, source_author,
      agent_confidence, agent_note, line, created_at, processed_at)
    VALUES (@id, @title, @summary, @key_points, @full_content, @raw_input,
      @primary_category, @secondary_category, @content_type, @tags, @priority,
      @source_type, @source_platform, @source_url, @source_author,
      @agent_confidence, @agent_note, @line, @created_at, @processed_at)
  `);
  const insertTodo = db.prepare(`
    INSERT OR IGNORE INTO todos (id, title, description, source_item_id, source_summary,
      category, priority, status, suggested_deadline, actual_deadline, tags, line, created_at, completed_at)
    VALUES (@id, @title, @description, @source_item_id, @source_summary,
      @category, @priority, @status, @suggested_deadline, @actual_deadline, @tags, @line, @created_at, @completed_at)
  `);

  transaction(() => {
    for (const it of payload.items) {
      if (!it?.id || !it.title) continue;
      const info = insertItem.run({
        id: it.id,
        title: String(it.title).slice(0, 60),
        summary: String(it.summary || '').slice(0, 300),
        key_points: JSON.stringify(Array.isArray(it.key_points) ? it.key_points : []),
        full_content: String(it.full_content || ''),
        raw_input: JSON.stringify(it.raw_input || {}),
        primary_category: isValidCategory(it.primary_category) ? it.primary_category : 'archive',
        secondary_category: String(it.secondary_category || 'insight'),
        content_type: String(it.content_type || 'insight'),
        tags: JSON.stringify(Array.isArray(it.tags) ? it.tags : []),
        priority: isValidPriority(it.priority) ? it.priority : 'medium',
        source_type: String(it.source_type || 'text'),
        source_platform: String(it.source_platform || 'manual'),
        source_url: it.source_url || null,
        source_author: it.source_author || null,
        agent_confidence: Number.isFinite(it.agent_confidence) ? it.agent_confidence : 0.8,
        agent_note: it.agent_note || null,
        line: isValidLine(it.line) ? it.line : 'trial',
        created_at: it.created_at || now,
        processed_at: it.processed_at || now,
      });
      itemsCount += info.changes;
    }
    for (const t of payload.todos || []) {
      if (!t?.id || !t.title) continue;
      const info = insertTodo.run({
        id: t.id,
        title: String(t.title).slice(0, 40),
        description: String(t.description || ''),
        source_item_id: t.source_item_id || null,
        source_summary: String(t.source_summary || ''),
        category: isValidCategory(t.category) ? t.category : 'growth',
        priority: isValidPriority(t.priority) ? t.priority : 'medium',
        status: isValidTodoStatus(t.status) ? t.status : 'pending',
        suggested_deadline: t.suggested_deadline || null,
        actual_deadline: t.actual_deadline || null,
        tags: JSON.stringify(Array.isArray(t.tags) ? t.tags : []),
        line: isValidLine(t.line) ? t.line : 'trial',
        created_at: t.created_at || now,
        completed_at: t.completed_at || null,
      });
      todosCount += info.changes;
    }
  })();

  res.json({ ok: true, items_imported: itemsCount, todos_imported: todosCount });
  broadcast('all', 'import');
});

// ---- 清空数据 ----
backupRouter.delete('/data', (req, res) => {
  transaction(() => {
    db.prepare('DELETE FROM item_relations').run();
    db.prepare('DELETE FROM todos').run();
    db.prepare('DELETE FROM items').run();
    db.prepare('DELETE FROM weekly_reports').run();
  })();
  broadcast('all', 'clear');
  res.json({ ok: true });
});
