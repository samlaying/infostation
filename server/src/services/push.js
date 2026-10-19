// ===== v2.5：主动推动（Proactive Push）=====
// 目标：不是等用户录入，而是系统主动说"今天该看这个"。
//
// 两个内容源：
//   1. 外部发现——AIHOT 匿名只读 API（ego-lite/skills/aihot 使用的同一接口），
//      拉最近精选，按用户主题/近期卡片做相关性排序。
//   2. 库内再发现——已入库但久未推进的卡片、7 天没动的主题。
// 外加「洗眼睛」浸泡建议（10 站轮换，来自 ego-lite GEWU 的浸泡层）。
//
// 设计约束：
//   - 推荐只负责"让你想起它/看见它"，绝不替用户执行（采纳后仍走既有 process 流程）。
//   - 每条必须带具体 reason；LLM 不可用时退化为规则排序，不阻断。
//   - 生成是幂等的：同一批（同一天 + 同来源集合）不重复堆积，旧批次自动过期。

import { nanoid } from 'nanoid';
import { db, rowToItem, rowToSuggestion } from '../db.js';
import { callLlm, llmConfigured, extractJson } from './agent.js';
import { broadcast } from './events.js';

const AIHOT_BASE = 'https://aihot.virxact.com';
const DAY = 86400000;
const KEEP_DAYS = 7; // 未处理建议保留天数
const MAX_SUGGESTIONS = 12;

// ---- 洗眼睛：10 站轮换（与 ego-lite platform-hunt/references/eyewash-library.md 对齐）----
// 星期索引 0=周日 … 6=周六
export const EYEWASH_STATIONS = [
  { key: 'mobbin', name: 'Mobbin', url: 'https://mobbin.com', role: '真实上线产品全流程', ask: '问"这设计怎么做出来的"，看功能怎么拆成流程' },
  { key: 'godly', name: 'Godly', url: 'https://recent.design', role: '前沿视觉实验室', ask: '给作品找 personality，跳舒适区' },
  { key: 'minimal', name: 'Minimal Gallery', url: 'https://minimal.gallery', role: '极简/减法美学', ask: '练减法敏感：这个元素真的有必要吗？' },
  { key: 'refero', name: 'Refero', url: 'https://refero.design', role: 'B 端/SaaS 天花板', ask: '学复杂信息组织：复杂留在系统，简单留给用户' },
  { key: 'dark', name: 'Dark.design', url: 'https://dark.design', role: '暗黑美学/Dark Mode', ask: '学"让重要的东西亮起来"，不是把一切变暗' },
  { key: 'spells', name: 'Design Spells', url: 'https://designspells.com', role: '微交互/动效细节', ask: '看 hover、反馈、切换那一下' },
  { key: 'lapa', name: 'Lapa Ninja', url: 'https://lapa.ninja', role: 'Landing Page / Hero 区', ask: '拆首屏 3 秒：你是谁/什么价值/为何看下去' },
  { key: 'typewolf', name: 'Typewolf', url: 'https://typewolf.com', role: '字体排版天花板', ask: '看字体如何当主角：字重对比、行距、节奏' },
  { key: 'loadmo', name: 'Load more', url: 'https://loadmo.re', role: '实验/放飞想象力', ask: '打破"设计应该长什么样"的想象' },
  { key: 'bdx', name: 'Best Designs on X', url: 'https://bestdesignsonx.com', role: 'X 上的鲜活实验', ask: '一键回 X 找作者，顺藤摸瓜' },
];

// 每日主站 + 破圈站（与 rotation-table 的浸泡列一致）
const EYEWASH_ROTATION = {
  0: { main: 'loadmo', edge: 'typewolf' },
  1: { main: 'bdx', edge: 'loadmo' },
  2: { main: 'dark', edge: 'godly' },
  3: { main: 'minimal', edge: 'loadmo' },
  4: { main: 'typewolf', edge: 'bdx' },
  5: { main: 'spells', edge: 'godly' },
  6: { main: 'godly', edge: 'bdx' },
};

export function todayEyewash(date = new Date()) {
  const dow = date.getDay();
  const pick = EYEWASH_ROTATION[dow] || EYEWASH_ROTATION[1];
  const main = EYEWASH_STATIONS.find((s) => s.key === pick.main);
  const edge = EYEWASH_STATIONS.find((s) => s.key === pick.edge);
  return { main, edge, weekday: dow };
}

// ---- 外部发现：AIHOT 精选 ----
async function fetchAihot(window = '24h', limit = 20) {
  const url = `${AIHOT_BASE}/api/v1/items?mode=selected&window=${window}&limit=${limit}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'InfoStation/2.5 (+proactive-push)' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    return items
      .filter((it) => it && it.title)
      .map((it) => ({
        external_id: it.id,
        title: String(it.title).slice(0, 120),
        summary: String(it.summary || '').slice(0, 300),
        reason_src: String(it.reason || '').slice(0, 200),
        category: it.category || null,
        score_src: Number(it.score) || 0,
        url: it.links?.original || it.links?.aihot || '',
        aihot_url: it.links?.aihot || '',
        published_at: it.publishedAt || null,
        source_name: it.source?.name || '',
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ---- 库内再发现：久未推进的卡片 / 沉睡主题 ----
// 只推"真的搁置了"的卡：入库不足 1 天的卡还在正常消化期，推它等于催人。
// 门槛用 1 天（不是 2）——卡片是按"天"感知的，隔天没动就该被提一次。
const STALE_ITEM_DAYS = 1;
const STALE_TOPIC_DAYS = 2; // 主题比单卡更"重"，荒废门槛也更高一点

function gatherLocalCandidates() {
  const staleItems = db
    .prepare(
      `SELECT i.id, i.title, i.summary, i.line, i.topic_id, i.created_at, i.updated_at,
              t.name AS topic_name,
              (SELECT COUNT(*) FROM todos td WHERE td.source_item_id = i.id AND td.status = 'pending') AS open_todos,
              -- 过滤用浮点（精确到小时），展示用四舍五入到天
              CAST(ROUND(julianday('now') - julianday(i.updated_at)) AS INTEGER) AS idle_days
       FROM items i LEFT JOIN topics t ON t.id = i.topic_id
       WHERE i.item_type != 'bundle'
         AND julianday('now') - julianday(COALESCE(NULLIF(i.updated_at, ''), i.created_at)) >= ?
       ORDER BY idle_days DESC,
         CASE WHEN (SELECT COUNT(*) FROM todos td WHERE td.source_item_id = i.id AND td.status = 'pending') > 0 THEN 0 ELSE 1 END
       LIMIT 12`
    )
    .all(STALE_ITEM_DAYS);

  const staleTopics = db
    .prepare(
      `SELECT t.id, t.name, t.description,
              COUNT(i.id) AS item_count,
              MAX(COALESCE(i.updated_at, i.created_at)) AS last_active,
              CAST(ROUND(julianday('now') - julianday(MAX(COALESCE(i.updated_at, i.created_at)))) AS INTEGER) AS idle_days
       FROM topics t LEFT JOIN items i ON i.topic_id = t.id
       WHERE t.status = 'active'
       GROUP BY t.id
       HAVING item_count > 0
          AND julianday('now') - julianday(MAX(COALESCE(i.updated_at, i.created_at))) >= ?
       ORDER BY idle_days DESC
       LIMIT 5`
    )
    .all(STALE_TOPIC_DAYS);

  return { staleItems, staleTopics };
}

// ---- LLM 排序：把候选压成"今天最值得看的 N 条"，每条给具体理由 ----
async function rankCandidates({ external, staleItems, staleTopics, topics, recentTitles }) {
  const fallback = () => {
    const out = [];
    for (const it of external.slice(0, 6)) {
      out.push({
        kind: 'discover',
        title: it.title,
        reason: it.reason_src || `AIHOT 精选（${it.source_name || '外部来源'}）· ${it.category || 'AI'} 分类`,
        hook: it.summary.slice(0, 120),
        score: 50 + Math.min(30, it.score_src / 4),
        payload: { external_id: it.external_id, url: it.url, aihot_url: it.aihot_url, source_name: it.source_name, summary: it.summary },
      });
    }
    for (const s of staleItems.slice(0, 4)) {
      out.push({
        kind: 'item',
        title: s.title,
        reason: s.open_todos > 0
          ? `这张卡还有 ${s.open_todos} 条 TODO 没动，已搁置 ${s.idle_days} 天`
          : `入库 ${s.idle_days} 天还没转化成行动`,
        hook: (s.summary || '').slice(0, 120),
        score: 40 + Math.min(30, s.idle_days),
        source_item_id: s.id,
        payload: { line: s.line, topic_id: s.topic_id, topic_name: s.topic_name, open_todos: s.open_todos },
      });
    }
    for (const t of staleTopics.slice(0, 2)) {
      out.push({
        kind: 'topic',
        title: `主题「${t.name}」${t.idle_days} 天没动了`,
        reason: `这个主题有 ${t.item_count} 张卡，但最近一次推进在 ${t.idle_days} 天前`,
        hook: (t.description || '').slice(0, 120) || '要不要挑一张卡继续往下推？',
        score: 35 + Math.min(25, t.idle_days),
        payload: { topic_id: t.id, topic_name: t.name, item_count: t.item_count },
      });
    }
    return out;
  };

  if (!llmConfigured()) return fallback();

  const cand = [
    ...external.map((e, i) => ({ ref: `E${i}`, type: 'external', title: e.title, summary: e.summary.slice(0, 160), note: e.reason_src, score_hint: e.score_src, category: e.category })),
    ...staleItems.map((s, i) => ({ ref: `I${i}`, type: 'item', title: s.title, summary: (s.summary || '').slice(0, 160), idle_days: s.idle_days, open_todos: s.open_todos })),
    ...staleTopics.map((t, i) => ({ ref: `T${i}`, type: 'topic', title: t.name, summary: (t.description || '').slice(0, 160), idle_days: t.idle_days, item_count: t.item_count })),
  ];
  if (!cand.length) return [];

  const system = `你是 InfoStation 的主动推荐引擎。用户在推进两类事：
- trial 线：值得试的东西 → 结论 + 行动
- media 线：话题/素材 → 选题 + 内容生产
你会收到候选池（外部资讯 E / 库内卡片 I / 主题 T）。挑出今天最值得用户花时间的条目并排序。

硬性要求：
1. 每条 reason 必须具体到"为什么是现在、为什么是他"——引用候选里的 idle_days / open_todos / 主题相关性，禁止"值得关注""很有价值"这类空话。
2. hook 是一句话切入点，不超过 40 字，要能直接下手。
3. 外部资讯优先选与用户主题相关的；完全无关的宁可不推。
4. 最多 8 条，宁缺毋滥。
5. ref 必须原样来自候选池，不许编造。`;

  const user = `## 用户主题
${topics.map((t) => `- ${t.name}${t.description ? `（${t.description.slice(0, 40)}）` : ''}`).join('\n') || '（暂无）'}

## 最近入库卡片标题
${recentTitles.map((t) => `- ${t}`).join('\n') || '（暂无）'}

## 候选池
${JSON.stringify(cand, null, 1)}

输出 JSON：{"picks":[{"ref":"E0","reason":"...","hook":"...","score":0-100}]}`;

  try {
    const raw = await callLlm(system, user, true, process.env.LLM_PLANNER_MODEL || undefined);
    const parsed = extractJson(raw);
    const picks = Array.isArray(parsed?.picks) ? parsed.picks : [];
    const out = [];
    const byRef = new Map();
    external.forEach((e, i) => byRef.set(`E${i}`, { type: 'external', data: e }));
    staleItems.forEach((s, i) => byRef.set(`I${i}`, { type: 'item', data: s }));
    staleTopics.forEach((t, i) => byRef.set(`T${i}`, { type: 'topic', data: t }));

    for (const p of picks.slice(0, 8)) {
      const hit = byRef.get(String(p?.ref || ''));
      if (!hit) continue;
      const reason = String(p.reason || '').slice(0, 160);
      const hook = String(p.hook || '').slice(0, 120);
      if (!reason) continue;
      if (hit.type === 'external') {
        const e = hit.data;
        out.push({
          kind: 'discover',
          title: e.title,
          reason,
          hook,
          score: Number(p.score) || 60,
          payload: { external_id: e.external_id, url: e.url, aihot_url: e.aihot_url, source_name: e.source_name, summary: e.summary },
        });
      } else if (hit.type === 'item') {
        const s = hit.data;
        out.push({
          kind: 'item',
          title: s.title,
          reason,
          hook,
          score: Number(p.score) || 50,
          source_item_id: s.id,
          payload: { line: s.line, topic_id: s.topic_id, topic_name: s.topic_name, open_todos: s.open_todos },
        });
      } else {
        const t = hit.data;
        out.push({
          kind: 'topic',
          title: `主题「${t.name}」该推进了`,
          reason,
          hook,
          score: Number(p.score) || 40,
          payload: { topic_id: t.id, topic_name: t.name, item_count: t.item_count },
        });
      }
    }
    return out.length ? out : fallback();
  } catch {
    return fallback();
  }
}

/**
 * LLM 可能把外部条目全判为"不相关"，但主动推动的产品意图是"让你看见新东西"，
 * 不能全被一票否决。这里保证至少保留 N 条最高分外部资讯，且与库内条目互不挤占。
 */
function ensureExternalQuota(ranked, external, minCount = 2) {
  const have = new Set(
    ranked.filter((r) => r.kind === 'discover').map((r) => r.payload?.external_id).filter(Boolean)
  );
  if (have.size >= minCount) return ranked;

  const extra = external
    .filter((e) => !have.has(e.external_id))
    .slice(0, minCount - have.size)
    .map((e) => ({
      kind: 'discover',
      title: e.title,
      reason: `AIHOT 今日精选（${e.source_name || '外部来源'}${e.category ? ` · ${e.category}` : ''}）${e.reason_src ? `——${e.reason_src}` : ''}`.slice(0, 200),
      hook: (e.summary || '').slice(0, 120),
      score: 45 + Math.min(20, e.score_src / 5),
      payload: { external_id: e.external_id, url: e.url, aihot_url: e.aihot_url, source_name: e.source_name, summary: e.summary },
    }));

  // 外部兜底插在洗眼睛之后、库内条目之前：新信息优先于"催旧账"
  const head = ranked.filter((r) => r.kind === 'discover');
  const rest = ranked.filter((r) => r.kind !== 'discover');
  return [...head, ...extra, ...rest];
}

/**
 * 生成一批建议。
 * @param {object} [opts]
 * @param {boolean} [opts.force] 强制新开一批（忽略当日已生成）
 * @returns {Promise<{batch:string, created:number, skipped:boolean}>}
 */
export async function generatePush(opts = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const batch = `${today}-${Date.now().toString(36).slice(-5)}`;

  if (!opts.force) {
    const existing = db
      .prepare(`SELECT COUNT(*) c FROM push_suggestions WHERE status = 'new' AND batch LIKE ?`)
      .get(`${today}-%`).c;
    if (existing > 0) return { batch: null, created: 0, skipped: true, reason: '今天已有未处理的推荐' };
  } else {
    // 强制重生成 = 用户明确要换一批：把上一批还没看的作废，避免同一张卡重复出现
    db.prepare(
      `UPDATE push_suggestions SET status = 'expired' WHERE status = 'new' AND batch LIKE ?`
    ).run(`${today}-%`);
  }

  // 过期清理：7 天前的未处理建议不再展示
  db.prepare(
    `UPDATE push_suggestions SET status = 'expired'
     WHERE status = 'new' AND created_at < datetime('now', ?)`
  ).run(`-${KEEP_DAYS} days`);

  const external = await fetchAihot('24h', 20);
  const { staleItems, staleTopics } = gatherLocalCandidates();
  const topics = db.prepare(`SELECT name, description FROM topics WHERE status = 'active' LIMIT 20`).all();
  const recentTitles = db
    .prepare(`SELECT title FROM items ORDER BY created_at DESC LIMIT 12`)
    .all()
    .map((r) => r.title);

  const rankedRaw = await rankCandidates({ external, staleItems, staleTopics, topics, recentTitles });
  const ranked = ensureExternalQuota(rankedRaw, external);

  // 洗眼睛（浸泡层）：每天一条，独立于 LLM 排序，永远保留
  const eyewash = todayEyewash();
  const ewSuggestion = {
    kind: 'eyewash',
    title: `洗眼睛 · ${eyewash.main.name}（${eyewash.main.role}）`,
    reason: `D0 浸泡层今日主站；破圈站 ${eyewash.edge.name}。5~10 分钟，不产出作品，只记一句"为什么心动"。`,
    hook: eyewash.main.ask,
    score: 100, // 浸泡层永远置顶：它是最容易被跳过、也最该每天做的一条
    payload: {
      station: eyewash.main.key,
      station_name: eyewash.main.name,
      station_url: eyewash.main.url,
      edge_station: eyewash.edge.key,
      edge_name: eyewash.edge.name,
      edge_url: eyewash.edge.url,
      ask: eyewash.main.ask,
      rule: '3 秒心动 → 写不超过 30 字；超 10 分钟还在刷 = 逛街',
    },
  };

  const all = [ewSuggestion, ...ranked].slice(0, MAX_SUGGESTIONS);
  const insert = db.prepare(
    `INSERT INTO push_suggestions (id, kind, source_item_id, title, reason, hook, payload, score, batch, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`
  );
  const now = new Date().toISOString();
  let created = 0;
  for (const s of all) {
    // 去重：同一来源条目 3 天内推过且未被处理，不重复推。
    // 洗眼睛例外——它每天固定一条、站点按星期轮换，重生成时必须补回。
    // expired 不算"推过"：那批用户根本没看见（force 重生成时被作废），应当允许重新出现。
    if (s.kind !== 'eyewash') {
      const dup = s.source_item_id
        ? db.prepare(
            `SELECT id FROM push_suggestions WHERE source_item_id = ? AND status IN ('new','accepted','dismissed')
             AND created_at > datetime('now','-3 days')`
          ).get(s.source_item_id)
        : db.prepare(
            `SELECT id FROM push_suggestions WHERE kind = ? AND title = ? AND status IN ('new','accepted','dismissed')
             AND created_at > datetime('now','-3 days')`
          ).get(s.kind, s.title);
      if (dup) continue;
    }
    insert.run(
      nanoid(),
      s.kind,
      s.source_item_id || null,
      String(s.title).slice(0, 160),
      String(s.reason).slice(0, 300),
      String(s.hook || '').slice(0, 200),
      JSON.stringify(s.payload || {}),
      Number(s.score) || 0,
      batch,
      now
    );
    created++;
  }

  broadcast('push', 'create', batch);
  console.log(`[push] 生成推荐 ${created} 条（批次 ${batch}，外部候选 ${external.length}，库内 ${staleItems.length}）`);
  return { batch, created, skipped: false, candidates: { external: external.length, items: staleItems.length, topics: staleTopics.length } };
}

export function listSuggestions({ status = 'new', limit = 30 } = {}) {
  const where = status === 'all' ? '' : 'WHERE status = ?';
  const params = status === 'all' ? [] : [status];
  return db
    .prepare(
      `SELECT * FROM push_suggestions ${where}
       ORDER BY CASE kind WHEN 'eyewash' THEN 0 ELSE 1 END, score DESC, created_at DESC
       LIMIT ?`
    )
    .all(...params, Math.min(100, limit))
    .map(rowToSuggestion);
}

/**
 * 采纳建议：只标记状态并返回"下一步动作"，真正的落库仍走既有 process / todos 接口。
 * 这样推荐引擎永远不绕过主流水线。
 */
export function acceptSuggestion(id) {
  const row = db.prepare('SELECT * FROM push_suggestions WHERE id = ?').get(id);
  if (!row) throw new Error('建议不存在');
  if (row.status !== 'new') throw new Error('该建议已处理过');
  const s = rowToSuggestion(row);

  let action = null;
  if (s.kind === 'discover') {
    const p = s.payload || {};
    const content = [
      p.summary || s.hook || s.title,
      p.url ? `来源：${p.url}` : '',
    ].filter(Boolean).join('\n');
    action = {
      type: 'process',
      content,
      line: 'trial',
      user_note: `主动推荐｜${p.source_name || 'AIHOT'}｜${p.aihot_url || p.url || ''}`,
    };
  } else if (s.kind === 'item') {
    action = { type: 'open_item', item_id: s.source_item_id };
  } else if (s.kind === 'topic') {
    action = { type: 'open_topic', topic_id: s.payload?.topic_id };
  } else if (s.kind === 'eyewash') {
    action = { type: 'open_url', url: s.payload?.station_url };
  }

  db.prepare(`UPDATE push_suggestions SET status = 'accepted', acted_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), id);
  broadcast('push', 'update', id);
  return { suggestion: { ...s, status: 'accepted' }, action };
}

export function dismissSuggestion(id) {
  // 不改写 reason 列——那是"为什么推给你"的原始依据，保留下来供复盘推荐质量
  const info = db
    .prepare(`UPDATE push_suggestions SET status = 'dismissed', acted_at = ? WHERE id = ? AND status = 'new'`)
    .run(new Date().toISOString(), id);
  if (!info.changes) throw new Error('建议不存在或已处理');
  broadcast('push', 'update', id);
  return { ok: true };
}
