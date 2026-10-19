// ===== 专职 TODO 拆解 / 续推 pass（v2.3 智能派工）=====
// 一次 pass（agent.js「私秘」）负责理解：清洗/摘要/分类/打标/提初步 TODO。
// 这里是第二次 LLM 调用，只干规划这一件事：
//   decomposeTodos —— 入库时把内容拆成带承接人/顺序/验收标准的步骤链
//   replanForItem  —— TODO 完成后复盘现状，续推下一步自动进 TODO
// 模型可用 LLM_PLANNER_MODEL 单独指定（缺省复用主模型）。
// 失败/未配 Key 一律静默降级（返回 null / 跳过），绝不阻断主流程。

import { nanoid } from 'nanoid';
import { db, rowToItem } from '../db.js';
import { callLlm, llmConfigured, extractJson } from './agent.js';
import { broadcast } from './events.js';
import { PRIORITIES, AGENT_EXECUTORS } from '../constants.js';

const MAX_STEPS = 6; // 单次拆解上限
const REPLAN_TODO_CAP = 12; // 单卡 TODO 总数达到此值不再续推（防雪球）

function plannerModel() {
  return process.env.LLM_PLANNER_MODEL || '';
}

// ---- 步骤归一化：字段校验 + needs_confirm 服务端定死（不信任 LLM 标志）----
// 只读的 search_agent 自动执行；动手的 local/content 卡确认门；user 无需确认。
function normalizeSteps(parsed) {
  const raw = Array.isArray(parsed?.steps) ? parsed.steps : [];
  const steps = [];
  for (const s of raw) {
    if (!s || typeof s.title !== 'string' || !s.title.trim()) continue;
    const agent = AGENT_EXECUTORS.includes(s.assigned_agent) ? s.assigned_agent : 'user';
    steps.push({
      title: s.title.trim().slice(0, 30),
      description: String(s.description || '').slice(0, 200),
      assigned_agent: agent,
      needs_confirm: agent === 'local_agent' || agent === 'content_agent',
      step_order: steps.length + 1,
      acceptance: String(s.acceptance || '').slice(0, 120),
      priority: PRIORITIES.includes(s.priority) ? s.priority : 'medium',
      suggested_days: Number.isFinite(Number(s.suggested_days)) && Number(s.suggested_days) > 0 ? Number(s.suggested_days) : 3,
    });
    if (steps.length >= MAX_STEPS) break;
  }
  const note = String(parsed?.plan_note || '').slice(0, 120);
  return { steps, note };
}

const EXECUTOR_DOC = `## 承接人定义（assigned_agent）
- user：必须用户本人做的（决策/沟通/亲身体验类）
- search_agent：联网调研（只读，自动执行不问）——搜教程/价格/最新讨论/GitHub 找方案仓库
- local_agent：本机操作（执行前需用户批准）——打开真实浏览器注册/试用/跑 demo/截图/clone 仓库
- content_agent：内容生产（执行前需用户批准）——把结论整理成自媒体文案素材、建选题卡`;

const PRINCIPLES_DOC = `## 拆解原则
- 步骤要形成推进链：先调研（search_agent）→ 再动手试（local_agent）→ 有价值再产内容（content_agent），不要并列几条互不相关的动作
- 第一条优先给 search_agent（自动跑，为后续备料），除非输入本身信息已足够
- 动手类步骤（注册/试用/clone/演示）给 local_agent，会卡在确认门等用户点头
- trial 线试通了且内容有传播价值，最后一条给 content_agent 建自媒体选题
- media 线（素材→内容工序）里 search_agent 负责补充素材/查证，工序类步骤给 user
- 纯知识/观点且无行动价值的输入：返回空 steps 数组
- title ≤ 20 字动词开头；acceptance 一句话说清做到什么算完成；suggested_days 为建议完成天数`;

/**
 * 专职拆解 pass：把一条输入拆成带承接人的步骤链。
 * @returns {{steps, note}|null} null = 降级（未配 Key / LLM 失败），调用方回退一次 pass 的 todos
 */
export async function decomposeTodos(rawInput, firstPass, opts = {}) {
  if (!llmConfigured()) return null;

  const goalsText = (opts.userGoals || []).join('、') || '职场提升、自媒体、副业';
  const topicText = opts.topic
    ? `归属主题：${opts.topic.name}${opts.topic.description ? `（${String(opts.topic.description).slice(0, 60)}）` : ''}`
    : '归属主题：无（Agent 未归入任何既有主题）';
  const lineDoc = opts.line === 'media'
    ? '产品线：media（自媒体线——这条输入是素材/话题，产出是内容）'
    : '产品线：trial（TODO 线——这条输入是值得试的东西，产出是行动结论）';

  const siblings = (opts.siblingTodos || [])
    .slice(0, 10)
    .map((t) => `- [${t.status === 'done' ? 'done' : t.status === 'in_progress' ? 'doing' : 'todo'}] ${String(t.title).slice(0, 24)}`)
    .join('\n');

  const system = `你是「私秘」的行动规划师。你的唯一任务：把一条信息拆解成 ${Math.min(MAX_STEPS, 5)} 条以内、按顺序推进的 TODO，并给每条指定承接人。你不做摘要不做分类，只做规划。

${EXECUTOR_DOC}

${PRINCIPLES_DOC}

## 输出格式（严格 JSON，不要输出任何其他文字）
{
  "steps": [
    {
      "title": "≤20字动词开头",
      "description": "补充说明（≤100字）",
      "assigned_agent": "user|search_agent|local_agent|content_agent",
      "step_order": 1,
      "acceptance": "做到什么算完成（一句话）",
      "priority": "high|medium|low",
      "suggested_days": 3
    }
  ],
  "plan_note": "一句话规划思路（给用户看的）"
}`;

  const user = `## 待拆解的内容
【标题】${firstPass.title}
【摘要】${firstPass.summary}
【要点】${(firstPass.key_points || []).join('；')}
【用户备注】${rawInput.user_note || '无'}
【原文节选】
${String(rawInput.raw_text || '').slice(0, 1500)}

## 上下文
用户目标：${goalsText}
${lineDoc}
${topicText}${siblings ? `\n该主题近期已有 TODO（不要重复拆已做过的）：\n${siblings}` : ''}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const content = await callLlm(system, user, attempt === 0, plannerModel());
      const parsed = extractJson(content);
      if (!parsed || !Array.isArray(parsed.steps)) throw new Error('拆解 pass 返回无法解析');
      return normalizeSteps(parsed);
    } catch (err) {
      if (attempt === 1) {
        console.warn('[planner] 拆解 pass 失败，回退一次 pass todos:', err.message);
        return null;
      }
    }
  }
}

// ===== 续推：TODO 完成后复盘 → 下一步自动进 TODO =====

const replanInFlight = new Set();

function appendAgentNote(itemId, text) {
  const row = db.prepare('SELECT agent_note FROM items WHERE id = ?').get(itemId);
  if (!row) return;
  const note = `${row.agent_note ? row.agent_note + '\n\n' : ''}${text}`;
  db.prepare('UPDATE items SET agent_note = ?, updated_at = ? WHERE id = ?').run(note, new Date().toISOString(), itemId);
  broadcast('items', 'update', itemId);
}

/** 插入续推出的 TODO（承接人照常，就绪后照常派工） */
function insertReplanTodos(itemId, topicId, line, category, steps, startOrder) {
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO todos (id, title, description, source_item_id, source_summary, category, priority, status,
      suggested_deadline, tags, line, topic_id, assigned_agent, step_order, acceptance, created_at, updated_at)
    VALUES (@id, @title, @description, @sid, @ssum, @category, @priority, 'pending',
      @deadline, '[]', @line, @topic_id, @agent, @order, @acceptance, @now, @now)
  `);
  const summary = db.prepare('SELECT summary FROM items WHERE id = ?').get(itemId)?.summary || '';
  for (const s of steps) {
    startOrder += 1;
    insert.run({
      id: nanoid(),
      title: s.title,
      description: s.description,
      sid: itemId,
      ssum: String(summary).slice(0, 100),
      category,
      priority: s.priority,
      deadline: new Date(Date.now() + (s.suggested_days || 3) * 86400000).toISOString().slice(0, 10),
      line,
      topic_id: topicId,
      agent: s.assigned_agent && s.assigned_agent !== 'user' ? s.assigned_agent : null,
      order: startOrder,
      acceptance: s.acceptance || '',
      now,
    });
  }
  if (steps.length) broadcast('todos', 'create');
  return startOrder;
}

/**
 * 续推 pass：某卡片的 TODO 完成后，复盘剩余步骤 + 已完成产出，续推 0-3 条下一步。
 * fire-and-forget，所有失败静默跳过（记 agent_note 或 console.warn）。
 * @param {string} itemId 卡片 id
 * @param {string} trigger todo_done | job_done
 */
export async function replanForItem(itemId, trigger = 'todo_done') {
  if (!llmConfigured()) return; // mock 模式不续推
  if (replanInFlight.has(itemId)) return;

  const item = rowToItem(db.prepare('SELECT * FROM items WHERE id = ?').get(itemId));
  if (!item) return;
  const todos = db.prepare('SELECT * FROM todos WHERE source_item_id = ?').all(itemId);
  if (todos.length >= REPLAN_TODO_CAP) return;
  const open = todos.filter((t) => ['pending', 'in_progress'].includes(t.status));
  // 卡片还有任何未完结步骤就先不续推——等整条链推进完再复盘，避免中途加噪音
  if (open.length) return;

  replanInFlight.add(itemId);
  try {
    const topic = item.topic_id ? db.prepare('SELECT name, description FROM topics WHERE id = ?').get(item.topic_id) : null;
    const jobNotes = db
      .prepare(`SELECT logs FROM agent_jobs WHERE item_id = ? ORDER BY id DESC LIMIT 3`)
      .all(itemId)
      .flatMap((r) => { try { return JSON.parse(r.logs || '[]'); } catch { return []; } })
      .filter((l) => l?.status === 'done' && l.result)
      .slice(0, 4)
      .map((l) => `· [${l.skill}] ${JSON.stringify(l.result).slice(0, 150)}`)
      .join('\n');

    const todoLines = todos
      .slice(0, 12)
      .map((t) => `- [${t.status}${t.assigned_agent ? `/${t.assigned_agent}` : ''}] ${t.title}`)
      .join('\n');

    const system = `你是「私秘」的续推规划师。一张卡片的某些步骤刚完成，你复盘现状，决定要不要补 0-3 条下一步 TODO。宁缺毋滥：没有真实推进价值就返回空 steps。

${EXECUTOR_DOC}

## 续推原则
- 已完成步骤的产出（调研简报/截图/clone 结果）里藏着下一步的线索，读它
- trial 线试通了：若结论有传播价值，补一条 content_agent 的选题/成文步骤；没试通，补 search_agent 查替代方案
- media 线：素材齐了补 user 的成稿工序
- 不重复已有 TODO；步数 ≤ 3
- title ≤ 20 字动词开头，acceptance 一句话说清

## 输出格式（严格 JSON）
{ "steps": [ { "title": "...", "description": "...", "assigned_agent": "...", "step_order": 1, "acceptance": "...", "priority": "high|medium|low", "suggested_days": 3 } ], "plan_note": "一句话续推思路" }`;

    const user = `## 卡片
【标题】${item.title}
【摘要】${item.summary}
【主题】${topic ? topic.name + (topic.description ? `（${String(topic.description).slice(0, 60)}）` : '') : '无'}
【产品线】${item.line}

## 全部 TODO 现状
${todoLines || '（无）'}

## 已完成步骤的产出摘要
${jobNotes || '（无）'}`;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const content = await callLlm(system, user, attempt === 0, plannerModel());
        const parsed = extractJson(content);
        if (!parsed || !Array.isArray(parsed.steps)) throw new Error('续推 pass 返回无法解析');
        const { steps, note } = normalizeSteps(parsed);
        if (steps.length) {
          const maxOrder = todos.reduce((m, t) => Math.max(m, t.step_order || 0), 0);
          insertReplanTodos(itemId, item.topic_id, item.line, item.primary_category, steps, maxOrder);
          appendAgentNote(itemId, `🧭 续推（${trigger}）：新增 ${steps.length} 条${note ? `——${note}` : ''}`);
          console.log(`[planner] 续推 item ${itemId.slice(0, 6)}… +${steps.length} 条`);
        }
        return;
      } catch (err) {
        if (attempt === 1) {
          console.warn('[planner] 续推 pass 失败（跳过）:', err.message);
          return;
        }
      }
    }
  } finally {
    replanInFlight.delete(itemId);
  }
}
