// ===== POST /api/v1/process — Agent 处理流水线（核心）=====
// 输入（URL/文本/想法）→ URL 抓取 → 判重 → Agent（LLM/Mock）→ 落库 → 返回结果

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db, rowToItem, rowToTodo, getSetting, transaction } from '../db.js';
import { runAgent, llmConfigured } from '../services/agent.js';
import { extractUrl } from '../services/extractor.js';
import { findDuplicate } from '../services/dedup.js';
import { detectPlatform, isUrl, isValidCategory, isValidPriority } from '../constants.js';

export const processRouter = Router();

processRouter.post('/process', async (req, res, next) => {
  try {
    const {
      content,
      source_type = 'text',
      preferred_category,
      preferred_priority,
      user_note = '',
      user_context = '',
    } = req.body || {};

    if (!content || !String(content).trim()) {
      return res.status(400).json({ error: '内容不能为空' });
    }
    const rawContent = String(content).trim();

    // ---- Step 1: URL 输入先抓取 ----
    let rawInput;
    let sourceType = source_type;
    if (isUrl(rawContent)) {
      sourceType = 'url';
      const extraction = await extractUrl(rawContent);
      if (!extraction.ok) {
        // 抓取失败不阻断：降级为把 URL 本身作为文本处理，并带上提示
        rawInput = {
          id: nanoid(),
          source_type: 'url',
          source_platform: extraction.platform,
          raw_url: rawContent,
          raw_text: rawContent,
          raw_title: '',
          input_time: new Date().toISOString(),
          user_note: user_note || undefined,
        };
        var extractWarning = `${extraction.error} ${extraction.tip || ''}`.trim();
      } else {
        rawInput = {
          id: nanoid(),
          source_type: 'url',
          source_platform: extraction.platform,
          raw_url: extraction.data.raw_url,
          raw_text: extraction.data.raw_text,
          raw_title: extraction.data.raw_title,
          raw_metadata: extraction.data.raw_metadata,
          input_time: new Date().toISOString(),
          user_note: user_note || undefined,
        };
      }
    } else {
      rawInput = {
        id: nanoid(),
        source_type: source_type === 'manual' ? 'manual' : 'text',
        source_platform: 'manual',
        raw_text: rawContent,
        raw_title: '',
        input_time: new Date().toISOString(),
        user_note: user_note || undefined,
      };
    }

    // ---- Step 2: 判重（>85% 相似直接返回已有条目）----
    const dup = findDuplicate(rawInput.raw_text);
    if (dup) {
      const existing = rowToItem(
        db.prepare('SELECT * FROM items WHERE id = ?').get(dup.item.id)
      );
      return res.status(409).json({
        error: `与 ${(dup.similarity * 100).toFixed(0)}% 相似的内容已存在（${dup.item.title.slice(0, 30)}）`,
        duplicate_of: existing,
        similarity: dup.similarity,
      });
    }

    // ---- Step 3: Agent 处理 ----
    const userGoals = getSetting('user_goals', ['career', 'media', 'sidehustle']);
    const topTags = db
      .prepare(`SELECT tags FROM items ORDER BY created_at DESC LIMIT 50`)
      .all()
      .flatMap((r) => { try { return JSON.parse(r.tags); } catch { return []; } });

    const result = await runAgent(rawInput, {
      preferredCategory: isValidCategory(preferred_category) ? preferred_category : undefined,
      preferredPriority: isValidPriority(preferred_priority) ? preferred_priority : undefined,
      userGoals,
      userContext: user_context,
      existingTags: [...new Set(topTags)].slice(0, 20),
    });

    if (extractWarning) {
      result.agent_note = `${extractWarning}\n${result.agent_note || ''}`.trim();
    }

    // ---- Step 4: 事务落库 ----
    const now = new Date().toISOString();
    const itemId = nanoid();

    const insertItem = db.prepare(`
      INSERT INTO items (id, title, summary, key_points, full_content, raw_input,
        primary_category, secondary_category, content_type, tags, priority,
        source_type, source_platform, source_url, source_author,
        agent_confidence, agent_note, created_at, processed_at)
      VALUES (@id, @title, @summary, @key_points, @full_content, @raw_input,
        @primary_category, @secondary_category, @content_type, @tags, @priority,
        @source_type, @source_platform, @source_url, @source_author,
        @agent_confidence, @agent_note, @created_at, @processed_at)
    `);

    const insertTodo = db.prepare(`
      INSERT INTO todos (id, title, description, source_item_id, source_summary,
        category, priority, status, suggested_deadline, tags, created_at)
      VALUES (@id, @title, @description, @source_item_id, @source_summary,
        @category, @priority, 'pending', @suggested_deadline, @tags, @created_at)
    `);

    const todosToInsert = (result.todos || []).map((t) => {
      const days = Number.isFinite(t.suggested_days) && t.suggested_days > 0 ? t.suggested_days : 3;
      const deadline = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
      return {
        id: nanoid(),
        title: t.title,
        description: t.description || '',
        source_item_id: itemId,
        source_summary: result.summary.slice(0, 100),
        category: t.category || result.primary_category,
        priority: t.priority || result.priority,
        suggested_deadline: deadline,
        tags: JSON.stringify(result.tags.slice(0, 3)),
        created_at: now,
      };
    });

    transaction(() => {
      insertItem.run({
        id: itemId,
        title: result.title,
        summary: result.summary,
        key_points: JSON.stringify(result.key_points),
        full_content: result.full_content,
        raw_input: JSON.stringify(rawInput),
        primary_category: result.primary_category,
        secondary_category: result.secondary_category,
        content_type: result.content_type,
        tags: JSON.stringify(result.tags),
        priority: result.priority,
        source_type: rawInput.source_type,
        source_platform: rawInput.source_platform,
        source_url: rawInput.raw_url || null,
        source_author: rawInput.raw_metadata?.author || null,
        agent_confidence: result.agent_confidence,
        agent_note: result.agent_note || null,
        created_at: now,
        processed_at: now,
      });
      for (const t of todosToInsert) insertTodo.run(t);
    })();

    const item = rowToItem(db.prepare('SELECT * FROM items WHERE id = ?').get(itemId));
    const todos = db
      .prepare('SELECT * FROM todos WHERE source_item_id = ?')
      .all(itemId)
      .map(rowToTodo);

    res.status(201).json({
      processed_item: item,
      extracted_todos: todos,
      agent_mode: result.agent_mode,
      llm_configured: llmConfigured(),
    });
  } catch (err) {
    next(err);
  }
});
