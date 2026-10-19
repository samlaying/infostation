// ===== 预处理流水线执行器（Worker / Orchestrator）=====
// 卡片入库后由 runPipeline(item) 异步启动（process 路由 fire-and-forget，绝不阻塞 HTTP）：
//   1. planner 生成技能计划 → 写 agent_jobs
//   2. 顺序执行：server 步在本进程内跑；local 步（浏览器/gh）置 waiting_local，
//      由用户 Mac 上的 CLI worker 通过 /agent-jobs/claim 认领、/steps/:idx/complete 回传
//   3. 产物落库（assets / agent_note 追加），SSE 广播 jobs|items 让前端实时呼吸灯
// 单卡同时只允许一条活跃 job（重复录入由上游判重拦截，这里再兜一层）。

import { db, rowToItem, rowToJob } from '../db.js';
import { broadcast } from '../services/events.js';
import { planFor, planTodoJob } from './planner.js';
import { replanForItem } from '../services/planner-llm.js';
import { tavilyConfigured, tavilySearch } from '../skills/tavily.js';

const STEP_LABELS = {
  tavily_search: '联网调研（Tavily）',
  browser_screenshot: 'ego 浏览器截图',
  gh_inspect: 'GitHub 检查 + Clone',
  gh_search: 'GitHub 搜索',
  agent_task: 'Agent 委派任务',
};

function nowIso() {
  return new Date().toISOString();
}

function getJob(id) {
  return rowToJob(db.prepare('SELECT * FROM agent_jobs WHERE id = ?').get(id));
}

function saveJob(job) {
  db.prepare(
    `UPDATE agent_jobs SET status = @status, current_step = @current_step,
       skills_plan = @skills_plan, logs = @logs, error_msg = @error_msg, updated_at = @now
     WHERE id = @id`
  ).run({
    id: job.id,
    status: job.status,
    current_step: job.current_step,
    skills_plan: JSON.stringify(job.skills_plan),
    logs: JSON.stringify(job.logs),
    error_msg: job.error_msg || null,
    now: nowIso(),
  });
  broadcast('jobs', job.status === 'completed' ? 'completed' : 'update', job.item_id);
}

/** 卡片 agent_note 追加一段预处理产出（调研简报/Clone 路径等），并广播卡片更新 */
function appendAgentNote(itemId, text) {
  const row = db.prepare('SELECT agent_note FROM items WHERE id = ?').get(itemId);
  if (!row) return;
  const note = `${row.agent_note ? row.agent_note + '\n\n' : ''}${text}`;
  db.prepare('UPDATE items SET agent_note = ?, updated_at = ? WHERE id = ?').run(note, nowIso(), itemId);
  broadcast('items', 'update', itemId);
}

/** 入口：为卡片启动预处理（幂等：已有活跃 job 则跳过）。fire-and-forget。 */
export function runPipeline(itemId, trigger = 'process') {
  try {
    const active = db
      .prepare(`SELECT id FROM agent_jobs WHERE item_id = ? AND status IN ('pending','running','waiting_local')`)
      .get(itemId);
    if (active) return active.id;

    const item = rowToItem(db.prepare('SELECT * FROM items WHERE id = ?').get(itemId));
    if (!item) return null;
    const plan = planFor(item);
    if (!plan.length) return null;

    const info = db
      .prepare(`INSERT INTO agent_jobs (item_id, status, current_step, skills_plan, logs, created_at, updated_at)
                VALUES (?, 'pending', ?, ?, '[]', ?, ?)`)
      .run(itemId, `规划完成：${plan.map((p) => STEP_LABELS[p.skill]).join(' → ')}`, JSON.stringify(plan), nowIso(), nowIso());
    const job = getJob(Number(info.lastInsertRowid));
    broadcast('jobs', 'create', itemId);
    console.log(`[orchestrator] job#${job.id} 启动 (${trigger})：${plan.map((p) => p.skill).join(' → ')}`);
    // 异步推进，不阻塞调用方
    setImmediate(() => advance(job.id));
    return job.id;
  } catch (err) {
    console.error('[orchestrator] runPipeline 失败:', err.message);
    return null;
  }
}

/**
 * 推进流水线到下一个可执行步骤。
 * server 步在此进程内执行；local 步置 waiting_local 等待 CLI worker。
 * 由 runPipeline / completeStep（本地步回传后）调用。
 */
export function advance(jobId) {
  const job = getJob(jobId);
  if (!job || ['completed', 'failed'].includes(job.status)) return;

  const logs = job.logs;
  const idx = logs.length; // 顺序执行：logs 长度即下一步下标
  if (idx >= job.skills_plan.length) return finish(job);

  const step = job.skills_plan[idx];
  const entry = { skill: step.skill, status: 'running', started_at: nowIso(), result: null, error: null };

  // v2.3 确认门：needs_confirm 的步先卡住等用户批准（网页 Inspector / CLI jobs approve）
  if (step.needs_confirm) {
    job.status = 'awaiting_user';
    job.current_step = `⏸ 等你确认：${STEP_LABELS[step.skill]}（${step.reason || ''}）`;
    saveJob(job);
    return;
  }

  if (step.runtime === 'local') {
    // 交给本地 worker：置 waiting_local，claim 时会把该步标 running
    job.status = 'waiting_local';
    job.current_step = `等待本地 Agent 认领：${STEP_LABELS[step.skill]}`;
    saveJob(job);
    return;
  }

  // ---- server 步：进程内执行 ----
  job.status = 'running';
  job.current_step = `正在${STEP_LABELS[step.skill]}…`;
  saveJob(job);
  (async () => {
    try {
      const result = await runServerStep(step, job.item_id);
      entry.status = 'done';
      entry.result = result;
    } catch (err) {
      entry.status = 'failed';
      entry.error = err.message;
    }
    entry.finished_at = nowIso();
    logs.push(entry);
    saveJob({ ...job, logs });
    advance(jobId); // 递归推进下一步
  })();
}

async function runServerStep(step, itemId) {
  if (step.skill === 'tavily_search') {
    if (!tavilyConfigured()) {
      return { skipped: true, note: '未配置 TAVILY_API_KEY，调研简报跳过（配置后重新处理即可）' };
    }
    const data = await tavilySearch(step.params.query);
    if (data.summary) {
      const srcs = data.sources.map((s) => `· ${s.title} ${s.url}`).join('\n');
      appendAgentNote(itemId, `🔍 前置调研简报（Tavily）：\n${data.summary}\n\n参考来源：\n${srcs}`);
    }
    return data;
  }
  throw new Error(`未知 server 技能: ${step.skill}`);
}

// ===== v2.3：确认门（批准/跳过）+ TODO 派工 =====

/** 用户对 awaiting_user 的步做决定：approve=放行执行，skip=跳过该步继续推进 */
export function approveStep(jobId, action) {
  const job = getJob(jobId);
  if (!job) throw new Error('任务不存在');
  if (job.status !== 'awaiting_user') throw new Error('任务不在待确认状态');
  const step = job.skills_plan[job.logs.length];
  if (!step) throw new Error('没有待确认的步骤');

  if (action === 'skip') {
    const logs = job.logs;
    logs.push({
      skill: step.skill,
      status: 'skipped',
      result: null,
      error: null,
      started_at: nowIso(),
      finished_at: nowIso(),
    });
    job.logs = logs;
    job.current_step = `已跳过：${STEP_LABELS[step.skill]}`;
    saveJob(job);
    advance(jobId);
    return getJob(jobId);
  }

  // approve：local 步放行给 CLI worker 认领；server 步直接推进执行
  if (step.runtime === 'local') {
    job.status = 'waiting_local';
    job.current_step = `已批准，等待本地 Agent 认领：${STEP_LABELS[step.skill]}`;
    saveJob(job);
  } else {
    job.status = 'pending';
    saveJob(job);
    advance(jobId);
  }
  return getJob(jobId);
}

/** 单条 agent-TODO 的执行态写回 + 广播 */
function setTodoAuto(todoId, autoStatus, extra = {}) {
  if (!todoId) return;
  const sets = ['auto_status = ?', 'updated_at = ?'];
  const vals = [autoStatus, nowIso()];
  for (const [k, v] of Object.entries(extra)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  vals.push(todoId);
  db.prepare(`UPDATE todos SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  broadcast('todos', 'update', todoId);
}

/**
 * v2.3：派工入口——把卡片上「就绪」的 agent-TODO 变成 agent_jobs。
 * 就绪 = assigned_agent 非空 && status=pending && auto_status=''（未派发过）
 *        && 同卡没有更小 step_order 的未完结步骤（顺序推进，一次只放行最前一条）。
 * 挂载点：process 落库后 / agent job 终态后 / 手动完成 TODO 后。
 */
export function dispatchReadyTodos(itemId) {
  try {
    const todos = db
      .prepare(`SELECT * FROM todos WHERE source_item_id = ? AND assigned_agent IS NOT NULL
                AND status = 'pending' AND (auto_status = '' OR auto_status IS NULL)
                ORDER BY step_order, created_at`)
      .all(itemId);
    for (const todo of todos) {
      const blocked = db
        .prepare(`SELECT COUNT(*) c FROM todos WHERE source_item_id = ? AND id != ?
                  AND step_order < ? AND status IN ('pending','in_progress')`)
        .get(itemId, todo.id, todo.step_order || 0).c;
      if (blocked) continue; // 前面还有没走完的步骤，先不放行

      const item = rowToItem(db.prepare('SELECT * FROM items WHERE id = ?').get(itemId));
      if (!item) return;
      const plan = planTodoJob(todo, item);
      if (!plan.length) continue;

      const info = db
        .prepare(`INSERT INTO agent_jobs (item_id, todo_id, status, current_step, skills_plan, logs, created_at, updated_at)
                  VALUES (?, ?, 'pending', ?, ?, '[]', ?, ?)`)
        .run(itemId, todo.id, `规划完成：${plan.map((p) => STEP_LABELS[p.skill]).join(' → ')}`,
          JSON.stringify(plan), nowIso(), nowIso());
      setTodoAuto(todo.id, 'dispatched');
      broadcast('jobs', 'create', itemId);
      console.log(`[orchestrator] todo-job#${info.lastInsertRowid} 派发 (${todo.assigned_agent})：${todo.title.slice(0, 20)}`);
      setImmediate(() => advance(Number(info.lastInsertRowid)));
      return; // 一次只放行最前一条，链式推进
    }
  } catch (err) {
    console.error('[orchestrator] dispatchReadyTodos 失败:', err.message);
  }
}

/** CLI worker 认领：找到第一个处于 waiting_local 且技能匹配其能力 caps 的 job 步 */
export function claimLocalStep(caps = []) {
  const rows = db
    .prepare(`SELECT * FROM agent_jobs WHERE status = 'waiting_local' ORDER BY id LIMIT 10`)
    .all();
  for (const row of rows) {
    const job = rowToJob(row);
    const idx = job.logs.length;
    const step = job.skills_plan[idx];
    if (!step || step.runtime !== 'local') continue;
    if (!step.caps?.length) {
      // planner 未标注 caps 时按 registry 兜底
      const reg = { browser_screenshot: ['browser'], gh_inspect: ['gh'], gh_search: ['gh'], agent_task: ['agent'] }[step.skill] || [];
      if (!reg.some((c) => caps.includes(c))) continue;
    } else if (!step.caps.some((c) => caps.includes(c))) continue;
    job.status = 'running';
    job.current_step = `本地 Agent 正在${STEP_LABELS[step.skill]}…`;
    saveJob(job);
    if (job.todo_id) setTodoAuto(job.todo_id, 'running'); // v2.3：TODO 徽标同步"执行中"
    return { job: { id: job.id, item_id: job.item_id, status: job.status }, step_index: idx, step };
  }
  return null;
}

/** CLI worker 回传结果（可携带上传产物）。advanceStep 之后自动推进下一步。 */
export function completeStep(jobId, stepIndex, { ok = true, result = null, error = null } = {}) {
  const job = getJob(jobId);
  if (!job) throw new Error('job 不存在');
  const logs = job.logs;
  if (stepIndex !== logs.length) throw new Error(`步骤错位：期望第 ${logs.length} 步，收到第 ${stepIndex} 步`);
  const step = job.skills_plan[stepIndex];

  logs.push({
    skill: step.skill,
    status: ok ? 'done' : 'failed',
    result: result ? JSON.parse(JSON.stringify(result)) : null,
    error: error || null,
    started_at: logs[stepIndex - 1]?.finished_at || job.created_at,
    finished_at: nowIso(),
  });
  job.logs = logs;
  saveJob(job);

  // gh 检查的产出直接灌注到卡片：本地路径 + 安装命令（打开卡片即可开跑）
  if (ok && step.skill === 'gh_inspect' && result?.repo) {
    const lines = [`💻 已 Clone 至本地 ${result.clone_path || '（未克隆）'}`];
    if (result.repo_meta) {
      const m = result.repo_meta;
      lines.push(`⭐ ${m.stars ?? '?'} stars · ${m.language || '?'} · 最近推送 ${String(m.pushed_at || '?').slice(0, 10)}`);
    }
    if (result.install_hints?.length) lines.push(`安装命令（README 提取）：\n${result.install_hints.map((c) => `· ${c}`).join('\n')}`);
    appendAgentNote(job.item_id, lines.join('\n'));
  }
  // v2.3：gh 搜索结果摘要点缀到卡片（找仓库类调研步）
  // 字段兼容：gh CLI 返回 fullName/stargazersCount，内部约定 full_name/stars
  if (ok && step.skill === 'gh_search' && Array.isArray(result?.repos) && result.repos.length) {
    const lines = result.repos
      .slice(0, 5)
      .map((r) => {
        const name = r.full_name || r.fullName || '?';
        const stars = r.stars ?? r.stargazersCount ?? '?';
        const desc = r.description ? ` — ${String(r.description).slice(0, 60)}` : '';
        return `· ${name} ⭐${stars}${desc}`;
      })
      .join('\n');
    appendAgentNote(job.item_id, `🔎 GitHub 检索（${step.params?.query || ''}）：\n${lines}`);
  }
  // v2.3：Agent 委派任务的执行报告写进卡片（AI Agent 会话回传的文本结论）
  if (ok && step.skill === 'agent_task' && result?.report) {
    appendAgentNote(job.item_id, `🤖 Agent 执行报告（${result.title || step.params?.title || ''}）：\n${String(result.report).slice(0, 800)}`);
  }
  advance(jobId);
  return getJob(jobId);
}

/** 从 job 已完成步提取一句结果摘要（写回 TODO/卡片用） */
function summarizeJobResult(job) {
  const parts = [];
  for (const l of job.logs) {
    if (l.status !== 'done' || !l.result) continue;
    const r = l.result;
    if (l.skill === 'agent_task' && r.report) parts.push(String(r.report).slice(0, 160));
    else if (l.skill === 'tavily_search' && r.summary) parts.push(String(r.summary).slice(0, 120));
    else if (l.skill === 'gh_inspect' && r.clone_path) parts.push(`已 Clone：${r.clone_path}`);
    else if (l.skill === 'gh_search' && Array.isArray(r.repos) && r.repos[0]) parts.push(`GitHub：${r.repos[0].full_name}`);
    else if (l.skill === 'browser_screenshot' && r.asset_url) parts.push(`截图：${r.asset_url}`);
  }
  return parts.join('；').slice(0, 280);
}

function finish(job) {
  const doneN = job.logs.filter((l) => l.status === 'done').length;
  const failedN = job.logs.filter((l) => l.status === 'failed').length;
  const skippedN = job.logs.filter((l) => l.status === 'skipped').length;
  job.status = failedN === job.logs.length && job.logs.length ? 'failed' : 'completed';
  job.current_step = job.logs
    .map((l) => `${l.status === 'done' ? '✓' : l.status === 'failed' ? '✗' : l.status === 'skipped' ? '⏭' : '·'} ${STEP_LABELS[l.skill]}`)
    .join(' ');
  if (failedN) job.error_msg = job.logs.filter((l) => l.status === 'failed').map((f) => `${f.skill}: ${f.error}`).join('; ');
  saveJob(job);

  if (job.todo_id) {
    // v2.3：TODO 派发 job 终态收口——结果回写 TODO，链式放行下一条，然后续推复盘
    const todo = db.prepare('SELECT id, title, description FROM todos WHERE id = ?').get(job.todo_id);
    if (todo) {
      if (doneN > 0) {
        const summary = summarizeJobResult(job);
        db.prepare('UPDATE todos SET status = ?, completed_at = ?, auto_status = ?, description = ?, updated_at = ? WHERE id = ?')
          .run('done', nowIso(), 'done',
            summary ? `${todo.description}\n—\n🤖 ${summary}`.slice(0, 500) : todo.description,
            nowIso(), todo.id);
        broadcast('todos', 'completed', todo.id);
        appendAgentNote(job.item_id, `✅ TODO 完成（Agent）：${todo.title}`);
      } else if (skippedN === job.logs.length) {
        // 用户逐条跳过 → 该 TODO 归档（不做了）
        setTodoAuto(todo.id, 'skipped', { status: 'archived' });
      } else if (failedN === job.logs.length) {
        // 全失败 → 保持 pending 交给用户处置，标记 auto failed 不再自动重派
        setTodoAuto(todo.id, 'failed');
        appendAgentNote(job.item_id, `⚠️ TODO 自动执行失败（保留待手动处理）：${todo.title}`);
      }
    }
    dispatchReadyTodos(job.item_id);
    replanForItem(job.item_id, 'job_done'); // fire-and-forget
  } else if (job.status === 'completed') {
    appendAgentNote(job.item_id, `🤖 预处理完成（${doneN} 项技能）`);
  }
  console.log(`[orchestrator] job#${job.id} ${job.status}`);
}

/** 产物登记由路由层完成（需要写文件 + 建 asset），worker 只管编排 */
export function listJobs({ item_id, status, todo_id, limit = 20 } = {}) {
  const where = [];
  const params = [];
  if (item_id) { where.push('item_id = ?'); params.push(item_id); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (todo_id) { where.push('todo_id = ?'); params.push(todo_id); }
  const sql = `SELECT * FROM agent_jobs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ${Math.min(100, limit)}`;
  return db.prepare(sql).all(...params).map(rowToJob);
}
