// ===== 周报生成 =====
// 按周聚合数据统计 + 规则化 Agent 建议（PRD M6 格式），生成快照落库。

import { nanoid } from 'nanoid';
import { db } from '../db.js';

function mondayOf(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // 周一=0
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmt(d) {
  return d.toISOString().slice(0, 10);
}

/** 生成某周（默认本周）的周报快照 */
export function buildWeeklyReport(weekStart = mondayOf(new Date())) {
  const start = fmt(weekStart);
  const end = fmt(new Date(weekStart.getTime() + 6 * 86400000));
  const now = new Date().toISOString();

  const items = db
    .prepare('SELECT * FROM items WHERE substr(created_at,1,10) BETWEEN ? AND ? ORDER BY created_at DESC')
    .all(start, end);
  const todosCreated = db
    .prepare('SELECT * FROM todos WHERE substr(created_at,1,10) BETWEEN ? AND ?')
    .all(start, end);
  const todosDone = db
    .prepare("SELECT * FROM todos WHERE status='done' AND substr(completed_at,1,10) BETWEEN ? AND ?")
    .all(start, end);

  // 分类统计
  const catCount = {};
  for (const it of items) catCount[it.primary_category] = (catCount[it.primary_category] || 0) + 1;

  // 标签统计
  const tagCount = new Map();
  for (const it of items) {
    let tags = [];
    try { tags = JSON.parse(it.tags); } catch {}
    for (const t of tags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  }
  const topTags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t);

  // 待执行（按优先级）
  const nextStart = fmt(new Date(weekStart.getTime() + 7 * 86400000));
  const nextEnd = fmt(new Date(weekStart.getTime() + 13 * 86400000));
  const pending = db
    .prepare(
      `SELECT * FROM todos WHERE status IN ('pending','in_progress')
       AND (actual_deadline IS NOT NULL AND actual_deadline BETWEEN ? AND ?
            OR actual_deadline IS NULL AND suggested_deadline BETWEEN ? AND ?)
       ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`
    )
    .all(nextStart, nextEnd, nextStart, nextEnd);
  const overdue = db
    .prepare(
      `SELECT * FROM todos WHERE status IN ('pending','in_progress')
       AND COALESCE(actual_deadline, suggested_deadline) < date('now')
       AND priority = 'high' ORDER BY COALESCE(actual_deadline, suggested_deadline)`
    )
    .all();

  // Agent 建议（规则化）
  const suggestions = [];
  const catEntries = Object.entries(catCount).sort((a, b) => b[1] - a[1]);
  if (catEntries.length) {
    const [topCat, topCount] = catEntries[0];
    const catLabels = {
      career: '职场提升', media: '自媒体', sidehustle: '副业',
      growth: '认知成长', tools: '工具推荐', archive: '存档',
    };
    const doneRate = todosCreated.length ? todosDone.length / todosCreated.length : 0;
    if (topCount >= 5 && doneRate < 0.4) {
      suggestions.push(`本周「${catLabels[topCat] || topCat}」方向输入较多（${topCount} 条），但 TODO 完成率仅 ${Math.round(doneRate * 100)}%，建议暂缓收集，先执行已有计划。`);
    }
  }
  for (const cat of ['career', 'media', 'sidehustle']) {
    const backlog = db
      .prepare("SELECT COUNT(*) c FROM todos WHERE category = ? AND status IN ('pending','in_progress')")
      .get(cat).c;
    if (backlog >= 5) {
      const catLabels = { career: '职场提升', media: '自媒体', sidehustle: '副业' };
      suggestions.push(`${catLabels[cat]}方向 TODO 积压 ${backlog} 条，建议优先清理。`);
    }
  }
  if (overdue.length) {
    suggestions.push(`有 ${overdue.length} 条高优先级 TODO 已超期，建议今天优先处理「${overdue[0].title}」。`);
  }
  if (!suggestions.length) {
    suggestions.push('本周节奏健康，保持输入与执行的平衡。');
  }

  const completionRate = todosCreated.length
    ? Math.round((todosDone.length / todosCreated.length) * 100)
    : 0;

  return {
    id: nanoid(),
    week_start: start,
    week_end: end,
    created_at: now,
    data: {
      input_count: items.length,
      todo_created: todosCreated.length,
      todo_done: todosDone.length,
      completion_rate: completionRate,
      top_tags: topTags,
      category_count: catCount,
      completed_todos: todosDone.map((t) => ({ id: t.id, title: t.title, category: t.category, completed_at: t.completed_at })),
      pending_next_week: pending.map((t) => ({
        id: t.id, title: t.title, priority: t.priority,
        deadline: t.actual_deadline || t.suggested_deadline, category: t.category,
      })),
      overdue_high: overdue.map((t) => ({ id: t.id, title: t.title, deadline: t.actual_deadline || t.suggested_deadline })),
      agent_suggestions: suggestions,
    },
  };
}

/** 取本周周报（无则生成并落库）；force 重新生成。统一返回 { id, week_start, week_end, created_at, data } */
export function getOrCreateWeeklyReport(force = false) {
  const start = fmt(mondayOf(new Date()));
  if (!force) {
    const row = db.prepare('SELECT * FROM weekly_reports WHERE week_start = ?').get(start);
    if (row) return JSON.parse(row.snapshot);
  }
  const report = buildWeeklyReport();
  db.prepare(
    `INSERT INTO weekly_reports (id, week_start, snapshot, created_at) VALUES (?,?,?,?)
     ON CONFLICT(week_start) DO UPDATE SET snapshot = excluded.snapshot, created_at = excluded.created_at`
  ).run(report.id, report.week_start, JSON.stringify(report), report.created_at);
  return report;
}

export function listWeeklyReports() {
  return db
    .prepare('SELECT * FROM weekly_reports ORDER BY week_start DESC LIMIT 26')
    .all()
    .map((r) => JSON.parse(r.snapshot));
}
