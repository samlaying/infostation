// ===== POST /api/v1/process — Agent 处理流水线（核心）=====
// 输入（URL/文本/想法）→ URL 抓取 → 判重 → Agent（LLM/Mock）→ 落库 → 返回结果

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db, rowToItem, rowToTodo, getSetting, transaction } from '../db.js';
import { runAgent, llmConfigured } from '../services/agent.js';
import { decomposeTodos } from '../services/planner-llm.js';
import { extractUrl } from '../services/extractor.js';
import { findDuplicate } from '../services/dedup.js';
import { linkByTagOverlap } from '../services/relations.js';
import { broadcast } from '../services/events.js';
import { runPipeline, dispatchReadyTodos } from '../orchestrator/worker.js';
import { detectPlatform, isUrl, isValidCategory, isValidPriority, isValidLine } from '../constants.js';

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
      line,
      topic_id,
      skills = [],
    } = req.body || {};

    if (!content || !String(content).trim()) {
      return res.status(400).json({ error: '内容不能为空' });
    }
    const rawContent = String(content).trim();
    // 默认归 TODO 线；自媒体线需显式传 line=media
    const targetLine = isValidLine(line) ? line : 'trial';
    // v2.1：UI 主题选择器直挂（显式指定优先于 Agent 主题识别）
    const validSkills = Array.isArray(skills) ? skills.filter((s) => ['screenshot', 'ai_image'].includes(s)) : [];
    let explicitTopicId = null;
    if (Number.isFinite(Number(topic_id))) {
      const t = db.prepare('SELECT id FROM topics WHERE id = ?').get(Number(topic_id));
      if (!t) return res.status(400).json({ error: '主题不存在' });
      explicitTopicId = t.id;
    }

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

    const topicRows = db
      .prepare(`SELECT id, name, default_line FROM topics WHERE status = 'active' ORDER BY sort_order, id`)
      .all();

    const result = await runAgent(rawInput, {
      preferredCategory: isValidCategory(preferred_category) ? preferred_category : undefined,
      preferredPriority: isValidPriority(preferred_priority) ? preferred_priority : undefined,
      userGoals,
      userContext: user_context,
      existingTags: [...new Set(topTags)].slice(0, 20),
      line: targetLine,
      // v2.3：主题描述随名字一起进一次 pass 提示词（归属判断更准）
      topics: topicRows.map((t) => ({ name: t.name, description: t.description })),
    });

    // ---- v2.0：主题解析（Agent 返回主题名 → topic_id；新主题自动建档）----
    // v2.1：UI 显式指定 topic_id 时直接采用，跳过 Agent 猜测
    let topicId = explicitTopicId;
    if (!topicId && result.topic) {
      const hit = topicRows.find((t) => t.name === result.topic);
      if (hit) {
        topicId = hit.id;
      } else {
        const slug = result.topic.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
        const info = db
          .prepare(`INSERT INTO topics (name, slug, default_line) VALUES (?, ?, ?)`)
          .run(result.topic, slug || `topic-${Date.now()}`, targetLine);
        topicId = Number(info.lastInsertRowid);
      }
    }

    // ---- v2.0：卡片角色（确定性规则，不依赖 LLM）----
    // 输入以「选题｜」开头 → idea；「发布包」开头或标签含发布包 → bundle
    const roleText = `${rawContent}\n${user_note || ''}`;
    let itemType = 'material';
    if (/^发布包|^【发布包/.test(roleText) || (result.tags || []).includes('发布包')) itemType = 'bundle';
    else if (/^选题[｜:：]/.test(roleText) || (result.tags || []).includes('选题')) itemType = 'idea';

    // ---- Step 3.5（v2.3）：专职拆解 pass —— 带承接人/顺序/验收标准的步骤链 ----
    // 失败/未配 Key 返回 null，静默回退一次 pass 的 todos（全 user 承接）
    const topicRow = topicId ? topicRows.find((t) => t.id === topicId) : null;
    const siblingTodos = topicId
      ? db.prepare('SELECT title, status FROM todos WHERE topic_id = ? ORDER BY created_at DESC LIMIT 10').all(topicId)
      : [];
    const plan = await decomposeTodos(rawInput, result, {
      userGoals,
      line: targetLine,
      topic: topicRow ? { name: topicRow.name, description: topicRow.description } : null,
      siblingTodos,
    });
    let todosFromAgent = result.todos || [];
    if (plan && plan.note) {
      result.agent_note = `🧭 拆解：${plan.note}\n${result.agent_note || ''}`.trim();
    }
    if (plan && plan.steps.length) {
      todosFromAgent = plan.steps;
    }

    if (extractWarning) {
      result.agent_note = `${extractWarning}\n${result.agent_note || ''}`.trim();
    }
    // v2.1：Agent 技能开关（UI 点亮 📸截图/🎨生图）——记入 raw_input 与 agent_note，
    // 本地 Agent（CLI/Skill）处理该卡片时据此启动浏览器截图或生图并回填 assets
    if (validSkills.length) {
      rawInput.skills = validSkills;
      const skillText = validSkills.includes('screenshot') && validSkills.includes('ai_image')
        ? '待执行：Agent 网页截图 + AI 生成配图'
        : validSkills.includes('screenshot') ? '待执行：Agent 网页截图' : '待执行：AI 生成配图';
      result.agent_note = `${skillText}\n${result.agent_note || ''}`.trim();
    }

    // ---- Step 4: 事务落库 ----
    const now = new Date().toISOString();
    const itemId = nanoid();

    const insertItem = db.prepare(`
      INSERT INTO items (id, title, summary, key_points, full_content, raw_input,
        primary_category, secondary_category, content_type, tags, priority,
        source_type, source_platform, source_url, source_author,
        agent_confidence, agent_note, line, topic_id, item_type, parent_item_id,
        created_at, processed_at, updated_at)
      VALUES (@id, @title, @summary, @key_points, @full_content, @raw_input,
        @primary_category, @secondary_category, @content_type, @tags, @priority,
        @source_type, @source_platform, @source_url, @source_author,
        @agent_confidence, @agent_note, @line, @topic_id, @item_type, @parent_item_id,
        @created_at, @processed_at, @created_at)
    `);

    const insertTodo = db.prepare(`
      INSERT INTO todos (id, title, description, source_item_id, source_summary,
        category, priority, status, suggested_deadline, tags, line, topic_id,
        assigned_agent, step_order, acceptance, created_at, updated_at)
      VALUES (@id, @title, @description, @source_item_id, @source_summary,
        @category, @priority, 'pending', @suggested_deadline, @tags, @line, @topic_id,
        @assigned_agent, @step_order, @acceptance, @created_at, @created_at)
    `);

    const todosToInsert = todosFromAgent.map((t, i) => {
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
        line: targetLine,
        topic_id: topicId,
        assigned_agent: t.assigned_agent || null,
        step_order: typeof t.step_order === 'number' ? t.step_order : i + 1,
        acceptance: t.acceptance || '',
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
        line: targetLine,
        topic_id: topicId,
        item_type: itemType,
        parent_item_id: null,
        created_at: now,
        processed_at: now,
      });
      for (const t of todosToInsert) insertTodo.run(t);
      // v2.0：同主题 ≥2 共同标签的卡片自动建双向 tag_overlap 关联（激活 item_relations）
      linkByTagOverlap(itemId);
    })();

    // SSE 广播：卡片/TODO/新主题落库，订阅面板实时刷新
    broadcast('items', 'create', itemId);
    if (todosToInsert.length) broadcast('todos', 'create');
    if (topicId) broadcast('topics', 'create');

    // v2.2：异步启动预处理流水线（截图/调研/clone 由后台执行，不阻塞响应）
    const jobId = runPipeline(itemId, 'process');
    // v2.3：agent-TODO 派工（search 步即刻自动执行；local/content 步将卡确认门）
    dispatchReadyTodos(itemId);

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
      preexec_job_id: jobId || null,
    });
  } catch (err) {
    next(err);
  }
});
