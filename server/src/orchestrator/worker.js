// ===== 预处理流水线执行器（Worker / Orchestrator）=====
// 卡片入库后由 runPipeline(item) 异步启动（process 路由 fire-and-forget，绝不阻塞 HTTP）：
//   1. planner 生成技能计划 → 写 agent_jobs
//   2. 顺序执行：server 步在本进程内跑；local 步（浏览器/gh）置 waiting_local，
//      由用户 Mac 上的 CLI worker 通过 /agent-jobs/claim 认领、/steps/:idx/complete 回传
//   3. 产物落库（assets / agent_note 追加），SSE 广播 jobs|items 让前端实时呼吸灯
// 单卡同时只允许一条活跃 job（重复录入由上游判重拦截，这里再兜一层）。

import { db, rowToItem, rowToJob } from '../db.js';
import { broadcast } from '../services/events.js';
import { planFor } from './planner.js';
import { tavilyConfigured, tavilySearch } from '../skills/tavily.js';

const STEP_LABELS = {
  tavily_search: '联网调研（Tavily）',
  browser_screenshot: 'ego 浏览器截图',
  gh_inspect: 'GitHub 检查 + Clone',
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
      const reg = { browser_screenshot: ['browser'], gh_inspect: ['gh'] }[step.skill] || [];
      if (!reg.some((c) => caps.includes(c))) continue;
    } else if (!step.caps.some((c) => caps.includes(c))) continue;
    job.status = 'running';
    job.current_step = `本地 Agent 正在${STEP_LABELS[step.skill]}…`;
    saveJob(job);
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
  advance(jobId);
  return getJob(jobId);
}

function finish(job) {
  const failed = job.logs.filter((l) => l.status === 'failed');
  job.status = failed.length === job.logs.length && job.logs.length ? 'failed' : 'completed';
  job.current_step = job.logs.map((l) => `${l.status === 'done' ? '✓' : l.status === 'failed' ? '✗' : '·'} ${STEP_LABELS[l.skill]}`).join(' ');
  if (failed.length) job.error_msg = failed.map((f) => `${f.skill}: ${f.error}`).join('; ');
  saveJob(job);
  if (job.status === 'completed') {
    appendAgentNote(job.item_id, `🤖 预处理完成（${job.logs.filter((l) => l.status === 'done').length} 项技能）`);
  }
  console.log(`[orchestrator] job#${job.id} ${job.status}`);
}

/** 产物登记由路由层完成（需要写文件 + 建 asset），worker 只管编排 */
export function listJobs({ item_id, status, limit = 20 } = {}) {
  const where = [];
  const params = [];
  if (item_id) { where.push('item_id = ?'); params.push(item_id); }
  if (status) { where.push('status = ?'); params.push(status); }
  const sql = `SELECT * FROM agent_jobs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ${Math.min(100, limit)}`;
  return db.prepare(sql).all(...params).map(rowToJob);
}
