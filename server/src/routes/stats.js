// ===== /api/v1/stats — 数据看板 =====

import { Router } from 'express';
import { db } from '../db.js';
import { CATEGORIES } from '../constants.js';

export const statsRouter = Router();

function dayKey(d) {
  return d.toISOString().slice(0, 10);
}

/** 近 N 天每日输入量 + TODO 完成量 */
function trendSeries(days) {
  const start = new Date(Date.now() - (days - 1) * 86400000);
  const startKey = dayKey(start);
  const inputs = db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS c FROM items
       WHERE created_at >= ? GROUP BY d`
    )
    .all(startKey + 'T00:00:00');
  const dones = db
    .prepare(
      `SELECT substr(completed_at, 1, 10) AS d, COUNT(*) AS c FROM todos
       WHERE completed_at >= ? AND status = 'done' GROUP BY d`
    )
    .all(startKey + 'T00:00:00');

  const inputMap = new Map(inputs.map((r) => [r.d, r.c]));
  const doneMap = new Map(dones.map((r) => [r.d, r.c]));

  const series = [];
  for (let i = 0; i < days; i++) {
    const d = dayKey(new Date(start.getTime() + i * 86400000));
    series.push({ date: d, inputs: inputMap.get(d) || 0, todos_done: doneMap.get(d) || 0 });
  }
  return series;
}

statsRouter.get('/stats', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

  const totalItems = db.prepare('SELECT COUNT(*) c FROM items').get().c;
  const todayNew = db.prepare("SELECT COUNT(*) c FROM items WHERE substr(created_at,1,10) = ?").get(today).c;
  const yesterdayNew = db
    .prepare("SELECT COUNT(*) c FROM items WHERE substr(created_at,1,10) = ?")
    .get(dayKey(new Date(Date.now() - 86400000))).c;

  const totalTodos = db.prepare('SELECT COUNT(*) c FROM todos').get().c;
  const doneTodos = db.prepare("SELECT COUNT(*) c FROM todos WHERE status = 'done'").get().c;
  const pendingTodos = db.prepare("SELECT COUNT(*) c FROM todos WHERE status IN ('pending','in_progress')").get().c;
  const archivedTodos = db.prepare("SELECT COUNT(*) c FROM todos WHERE status = 'archived'").get().c;
  const weekDone = db.prepare("SELECT COUNT(*) c FROM todos WHERE status='done' AND substr(completed_at,1,10) >= ?").get(weekAgo).c;
  const weekCreated = db.prepare("SELECT COUNT(*) c FROM todos WHERE substr(created_at,1,10) >= ?").get(weekAgo).c;

  // v2.0：分线口径 —— TODO 总数 = 行动(trial) + 内容工序(media)，前端双轨条直接消费
  const lineSplit = db
    .prepare(
      `SELECT
         COUNT(CASE WHEN line = 'trial' THEN 1 END) AS trial_count,
         COUNT(CASE WHEN line = 'media' THEN 1 END) AS media_count
       FROM todos`
    )
    .get();

  // v2.1：卡片双线分布（数据看板「双线流水」图，替代旧 category 目标进度）
  const itemLineDist = db
    .prepare('SELECT line, COUNT(*) c FROM items GROUP BY line')
    .all()
    .reduce((acc, r) => ({ ...acc, [r.line]: r.c }), {});

  // 分类分布
  const categoryDist = CATEGORIES.map((cat) => ({
    category: cat,
    count: db.prepare('SELECT COUNT(*) c FROM items WHERE primary_category = ?').get(cat).c,
  }));
  const catTotal = categoryDist.reduce((a, b) => a + b.count, 0) || 1;

  // 平台分布
  const platformDist = db
    .prepare('SELECT source_platform AS platform, COUNT(*) c FROM items GROUP BY source_platform ORDER BY c DESC')
    .all();

  // 标签 TOP10
  const tagRows = db.prepare('SELECT tags FROM items ORDER BY created_at DESC LIMIT 500').all();
  const tagCount = new Map();
  for (const r of tagRows) {
    let tags = [];
    try { tags = JSON.parse(r.tags); } catch {}
    for (const t of tags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  }
  const topTags = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  // 目标进度（三大领域 TODO 完成率）
  const goalProgress = ['career', 'media', 'sidehustle'].map((cat) => {
    const total = db.prepare('SELECT COUNT(*) c FROM todos WHERE category = ?').get(cat).c;
    const done = db.prepare("SELECT COUNT(*) c FROM todos WHERE category = ? AND status = 'done'").get(cat).c;
    return { category: cat, total, done, rate: total ? done / total : 0 };
  });

  res.json({
    items: {
      total: totalItems,
      today_new: todayNew,
      yesterday_new: yesterdayNew,
      month_new: db.prepare('SELECT COUNT(*) c FROM items WHERE substr(created_at,1,10) >= ?').get(monthAgo).c,
    },
    todos: {
      total: totalTodos,
      trial_count: lineSplit.trial_count,
      media_count: lineSplit.media_count,
      done: doneTodos,
      pending: pendingTodos,
      archived: archivedTodos,
      completion_rate: totalTodos ? doneTodos / totalTodos : 0,
      week_done: weekDone,
      week_created: weekCreated,
      week_rate: weekCreated ? weekDone / weekCreated : 0,
    },
    trend_7d: trendSeries(7),
    trend_30d: trendSeries(30),
    category_distribution: categoryDist.map((c) => ({ ...c, percent: Math.round((c.count / catTotal) * 100) })),
    platform_distribution: platformDist,
    item_line_distribution: itemLineDist,
    top_tags: topTags,
    goal_progress: goalProgress,
  });
});
