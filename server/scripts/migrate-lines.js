#!/usr/bin/env node
// ===== 双线迁移脚本：按规则把存量 items/todos 分到 trial / media =====
//
// 背景：line 字段新增时默认全部为 'trial'。自媒体线（素材/选题/发布包）
// 需要被识别出来，否则内容工序会继续污染 TODO 面板。
//
// 用法：
//   node scripts/migrate-lines.js            # dry-run：只报告，不写库
//   node scripts/migrate-lines.js --apply    # 实际写入
//   node scripts/migrate-lines.js --url ... --token ...   # 针对远端（如生产）执行
//
// 规则（见 README/方案）：
//   卡片 media 判据：tags 含 选题/发布包/已发布，或 note/标题含「素材｜」，
//                    或来源备注标记为素材包/发布包
//   任务 media 判据：优先继承来源卡片的线；无来源卡片的，按标题内容工序动词判
//
// 安全：默认 dry-run；--apply 前请先 GET /api/v1/export 备份。

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const argVal = (k) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};

// 远端模式（对生产库执行）还是本地直连 SQLite
const REMOTE_URL = argVal('--url') || process.env.INFOSTATION_URL || null;
const REMOTE_TOKEN = argVal('--token') || process.env.INFOSTATION_TOKEN || null;

const MEDIA_ROLE_TAGS = ['选题', '发布包', '已发布'];
const MEDIA_TITLE_HINTS = ['素材｜', '素材|', '选题｜', '发布包｜', '发布记录｜'];
// 内容工序动词：标题命中即视为自媒体线的工作任务
const CONTENT_VERBS = ['撰写', '起草', '拆解', '提炼', '改写', '配图', '成稿', '定稿', '排版', '创作', '剪辑', '仿写', '扩写'];
// 任务标题里的自媒体关键词：即使来源卡片是 trial 线也应归 media
// （例：「整理为自媒体选题草稿」——无内容动词但显然是内容工序）
const MEDIA_TODO_HINTS = ['自媒体', '选题', '素材', '发布包', '发布记录'];

/** 判断一张卡片是否属于自媒体线 */
function classifyItem(item) {
  const tags = Array.isArray(item.tags) ? item.tags : [];
  if (tags.some((t) => MEDIA_ROLE_TAGS.includes(t))) return { line: 'media', why: `标签含「${tags.find((t) => MEDIA_ROLE_TAGS.includes(t))}」` };
  const hay = `${item.title || ''}\n${item.summary || ''}\n${item.agent_note || ''}\n${item.full_content || ''}`;
  if (MEDIA_TITLE_HINTS.some((h) => hay.includes(h))) return { line: 'media', why: '内容含「素材｜/选题｜/发布包｜」标记' };
  return { line: 'trial', why: '无自媒体特征' };
}

/** 判断一条任务是否属于自媒体线 */
function classifyTodo(todo, itemById) {
  const src = todo.source_item_id ? itemById[todo.source_item_id] : null;
  if (src && src.__line === 'media') return { line: 'media', why: `继承来源卡片「${String(src.title || '').slice(0, 16)}」` };
  const title = String(todo.title || '');
  // 标题直指自媒体：优先于动词判断，且不受来源卡片拖累
  const hint = MEDIA_TODO_HINTS.find((h) => title.includes(h));
  if (hint) return { line: 'media', why: `标题含「${hint}」` };
  const verb = CONTENT_VERBS.find((v) => title.includes(v));
  if (verb) return { line: 'media', why: `内容工序动词「${verb}」` };
  return { line: 'trial', why: src ? `来源卡片为 trial 线` : '无内容工序特征' };
}

function report(title, rows) {
  console.log(`\n${title}`);
  if (!rows.length) return console.log('  （无）');
  for (const r of rows) console.log(`  - ${r.label}\n      → ${r.line}（${r.why}）`);
}

async function loadRemote() {
  const h = { 'X-API-Key': REMOTE_TOKEN || '' };
  const j = async (p) => {
    const r = await fetch(`${REMOTE_URL.replace(/\/$/, '')}${p}`, { headers: h });
    if (!r.ok) throw new Error(`${p} → HTTP ${r.status}`);
    return r.json();
  };
  const items = (await j('/api/v1/items?page_size=60&page=1')).items || [];
  const todos = (await j('/api/v1/todos')).todos || [];
  return { items, todos };
}

async function applyRemote(itemUpdates, todoUpdates) {
  const h = { 'X-API-Key': REMOTE_TOKEN || '', 'Content-Type': 'application/json' };
  let ok = 0; const fails = [];
  for (const [id, line] of itemUpdates) {
    const r = await fetch(`${REMOTE_URL.replace(/\/$/, '')}/api/v1/items/${id}`, {
      method: 'PATCH', headers: h, body: JSON.stringify({ line }),
    });
    if (r.ok) ok++; else fails.push(`item ${id}: HTTP ${r.status}`);
  }
  for (const [id, line] of todoUpdates) {
    const r = await fetch(`${REMOTE_URL.replace(/\/$/, '')}/api/v1/todos/${id}`, {
      method: 'PATCH', headers: h, body: JSON.stringify({ line }),
    });
    if (r.ok) ok++; else fails.push(`todo ${id}: HTTP ${r.status}`);
  }
  return { ok, fails };
}

async function main() {
  console.log(`模式：${APPLY ? '⚠️  APPLY（会写库）' : '🔍 DRY-RUN（只读）'}`);
  console.log(`目标：${REMOTE_URL ? REMOTE_URL : '本地 SQLite'}`);

  let items; let todos; let applyFn = null;

  if (REMOTE_URL) {
    ({ items, todos } = await loadRemote());
    applyFn = applyRemote;
  } else {
    const { db, rowToItem, rowToTodo } = await import('../src/db.js');
    items = db.prepare('SELECT * FROM items').all().map(rowToItem);
    todos = db.prepare('SELECT * FROM todos').all().map(rowToTodo);
    applyFn = async (itemUpdates, todoUpdates) => {
      let ok = 0;
      const tx = () => {
        const si = db.prepare('UPDATE items SET line = ? WHERE id = ?');
        for (const [id, line] of itemUpdates) { si.run(line, id); ok++; }
        const st = db.prepare('UPDATE todos SET line = ? WHERE id = ?');
        for (const [id, line] of todoUpdates) { st.run(line, id); ok++; }
      };
      db.exec('BEGIN');
      try { tx(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
      return { ok, fails: [] };
    };
  }

  console.log(`\n读到：${items.length} 张卡片、${todos.length} 条任务`);

  // ---- 分类卡片 ----
  const itemById = {};
  const itemUpdates = [];
  const itemRows = [];
  for (const it of items) {
    const { line, why } = classifyItem(it);
    itemById[it.id] = { ...it, __line: line };
    itemRows.push({ label: `[${it.line}→${line}] ${String(it.title || '').slice(0, 34)}`, line, why });
    if (it.line !== line) itemUpdates.push([it.id, line]);
  }

  // ---- 分类任务（依赖卡片结果）----
  const todoUpdates = [];
  const todoRows = [];
  for (const t of todos) {
    const { line, why } = classifyTodo(t, itemById);
    todoRows.push({ label: `[${t.line}→${line}] ${String(t.title || '').slice(0, 34)}`, line, why });
    if (t.line !== line) todoUpdates.push([t.id, line]);
  }

  report('卡片分类结果：', itemRows);
  report('任务分类结果：', todoRows);

  const mediaItems = itemRows.filter((r) => r.line === 'media').length;
  const mediaTodos = todoRows.filter((r) => r.line === 'media').length;
  console.log(`\n汇总：卡片 media ${mediaItems}/${items.length}，任务 media ${mediaTodos}/${todos.length}`);
  console.log(`待更新：卡片 ${itemUpdates.length} 张，任务 ${todoUpdates.length} 条`);

  if (!APPLY) {
    console.log('\n（dry-run 结束。确认无误后加 --apply 执行）');
    return;
  }

  const { ok, fails } = await applyFn(itemUpdates, todoUpdates);
  console.log(`\n✅ 已更新 ${ok} 条${fails.length ? `，失败 ${fails.length} 条：` : ''}`);
  for (const f of fails) console.log('   ✗', f);
}

main().catch((e) => { console.error('迁移失败：', e.message); process.exit(1); });
