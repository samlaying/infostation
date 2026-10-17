// ===== /api/v1/assets + /api/v1/posts — v2.0 媒体资产与帖子产出 =====
// assets：承接本地 Agent 浏览器截图、AI 生图、上传图床后的 URL 登记
// posts：多平台帖子（文案 + 绑定的 asset 顺序 + 发布状态与回执链接）

import { Router } from 'express';
import { db, rowToAsset, rowToPost } from '../db.js';
import {
  isValidAssetType,
  isValidPostPlatform,
  isValidPostStatus,
} from '../constants.js';
import { broadcast } from '../services/events.js';

export const assetsRouter = Router();
export const postsRouter = Router();

// ---------- assets ----------

assetsRouter.get('/assets', (req, res) => {
  const { item_id, todo_id, type } = req.query;
  const where = [];
  const params = [];
  if (item_id) { where.push('a.item_id = ?'); params.push(item_id); }
  if (todo_id) { where.push('a.todo_id = ?'); params.push(todo_id); }
  if (isValidAssetType(type)) { where.push('a.asset_type = ?'); params.push(type); }

  const rows = db
    .prepare(
      `SELECT a.* FROM assets a ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY a.created_at DESC, a.id DESC LIMIT 500`
    )
    .all(...params)
    .map(rowToAsset);
  res.json({ assets: rows });
});

assetsRouter.post('/assets', (req, res) => {
  const { item_id, todo_id, asset_type, local_path, remote_url, source_url, prompt, metadata } = req.body || {};
  if (!item_id || !db.prepare('SELECT id FROM items WHERE id = ?').get(item_id)) {
    return res.status(400).json({ error: 'item_id 必须指向存在的卡片' });
  }
  if (!isValidAssetType(asset_type)) {
    return res.status(400).json({ error: `asset_type 必须是 screenshot/ai_image/upload/video` });
  }
  if (!local_path && !remote_url) {
    return res.status(400).json({ error: 'local_path 与 remote_url 至少提供一个' });
  }

  const info = db
    .prepare(
      `INSERT INTO assets (item_id, todo_id, asset_type, local_path, remote_url, source_url, prompt, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      item_id,
      todo_id || null,
      asset_type,
      local_path || null,
      remote_url || null,
      source_url || null,
      prompt || null,
      JSON.stringify(metadata || {})
    );
  broadcast('assets', 'create');
  res.status(201).json(rowToAsset(db.prepare('SELECT * FROM assets WHERE id = ?').get(info.lastInsertRowid)));
});

assetsRouter.patch('/assets/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM assets WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: '资产不存在' });

  const b = req.body || {};
  const updates = {};
  if (typeof b.local_path === 'string') updates.local_path = b.local_path;
  if (typeof b.remote_url === 'string') updates.remote_url = b.remote_url;
  if (typeof b.prompt === 'string') updates.prompt = b.prompt;
  if (b.metadata && typeof b.metadata === 'object') updates.metadata = JSON.stringify(b.metadata);
  if (!Object.keys(updates).length) return res.status(400).json({ error: '没有可更新的字段' });

  const setSql = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE assets SET ${setSql} WHERE id = @id`).run({ ...updates, id });
  broadcast('assets', 'update', id);
  res.json(rowToAsset(db.prepare('SELECT * FROM assets WHERE id = ?').get(id)));
});

assetsRouter.delete('/assets/:id', (req, res) => {
  db.prepare('DELETE FROM assets WHERE id = ?').run(req.params.id);
  broadcast('assets', 'delete', req.params.id);
  res.json({ ok: true });
});

// ---------- posts ----------

postsRouter.get('/posts', (req, res) => {
  const { source_item_id, topic_id, platform, status } = req.query;
  const where = [];
  const params = [];
  if (source_item_id) { where.push('p.source_item_id = ?'); params.push(source_item_id); }
  if (topic_id) { where.push('p.topic_id = ?'); params.push(Number(topic_id)); }
  if (isValidPostPlatform(platform)) { where.push('p.platform = ?'); params.push(platform); }
  if (isValidPostStatus(status)) { where.push('p.status = ?'); params.push(status); }

  const rows = db
    .prepare(
      `SELECT p.* FROM posts p ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY p.created_at DESC, p.id DESC LIMIT 200`
    )
    .all(...params)
    .map(rowToPost);
  res.json({ posts: rows });
});

postsRouter.post('/posts', (req, res) => {
  const { source_item_id, topic_id, platform = 'xiaohongshu', title, content_body = '', asset_ids = [] } =
    req.body || {};
  if (!source_item_id || !db.prepare('SELECT id FROM items WHERE id = ?').get(source_item_id)) {
    return res.status(400).json({ error: 'source_item_id 必须指向存在的卡片（选题或素材）' });
  }
  if (!title || !String(title).trim()) return res.status(400).json({ error: '帖子标题不能为空' });
  if (!isValidPostPlatform(platform)) {
    return res.status(400).json({ error: `platform 必须是 ${'xiaohongshu/wechat/x/bilibili/zhihu'}` });
  }
  if (!Array.isArray(asset_ids)) return res.status(400).json({ error: 'asset_ids 必须是数组' });

  const info = db
    .prepare(
      `INSERT INTO posts (source_item_id, topic_id, platform, title, content_body, asset_ids)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(source_item_id, topic_id || null, platform, String(title).trim(), content_body, JSON.stringify(asset_ids));

  broadcast('posts', 'create');
  res.status(201).json(rowToPost(db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid)));
});

postsRouter.patch('/posts/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: '帖子不存在' });

  const b = req.body || {};
  const updates = { updated_at: datetimeNow() };
  if (typeof b.title === 'string' && b.title.trim()) updates.title = b.title.trim();
  if (typeof b.content_body === 'string') updates.content_body = b.content_body;
  if (Array.isArray(b.asset_ids)) updates.asset_ids = JSON.stringify(b.asset_ids);
  if (isValidPostPlatform(b.platform)) updates.platform = b.platform;
  if (isValidPostStatus(b.status)) updates.status = b.status;
  if (typeof b.published_url === 'string') {
    updates.published_url = b.published_url;
    if (b.published_url && b.status === 'published') updates.published_at = datetimeNow();
  }

  const setSql = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE posts SET ${setSql} WHERE id = @id`).run({ ...updates, id });
  broadcast('posts', 'update', id);
  res.json(rowToPost(db.prepare('SELECT * FROM posts WHERE id = ?').get(id)));
});

postsRouter.delete('/posts/:id', (req, res) => {
  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  broadcast('posts', 'delete', req.params.id);
  res.json({ ok: true });
});

function datetimeNow() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}
