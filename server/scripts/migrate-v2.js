#!/usr/bin/env node
// ===== v2.0 存量清洗：把 tags/category 里的隐式语义「扶正」为结构 =====
//
// 1. 初始化核心主题（INSERT OR IGNORE，幂等）
// 2. items.item_type：tags 含 发布包→bundle / 选题→idea，其余 material
// 3. items.topic_id：tags 含主题名→挂载；media 线且无主题→挂「自媒体」
// 4. todos.topic_id：继承来源卡片
//
// 用法：
//   node scripts/migrate-v2.js            # dry-run：只报告
//   node scripts/migrate-v2.js --apply    # 实际写库
//   node scripts/migrate-v2.js --url ... --token ...  # 远端模式
//
// 安全：写前先备份（本地 SQLite 模式请确保 server/data 已备份）。

import fs from 'node:fs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const argVal = (k) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};
const REMOTE_URL = argVal('--url') || process.env.INFOSTATION_URL || null;
const REMOTE_TOKEN = argVal('--token') || process.env.INFOSTATION_TOKEN || null;

const CORE_TOPICS = [
  { name: '产品实习', icon: '💼', default_line: 'trial', sort_order: 1 },
  { name: '产品练习', icon: '🎯', default_line: 'trial', sort_order: 2 },
  { name: '硬件', icon: '🔧', default_line: 'trial', sort_order: 3 },
  { name: '自媒体', icon: '✍️', default_line: 'media', sort_order: 4 },
  { name: '副业', icon: '🚀', default_line: 'trial', sort_order: 5 },
];

/** tags JSON 文本里是否含某标签（精确匹配数组元素） */
function hasTag(tagsJson, name) {
  try {
    return JSON.parse(tagsJson || '[]').includes(name);
  } catch {
    return false;
  }
}

function classifyType(tagsJson, rawText) {
  if (hasTag(tagsJson, '发布包')) return 'bundle';
  if (hasTag(tagsJson, '选题')) return 'idea';
  if (/^选题[｜:：]/.test(String(rawText || ''))) return 'idea';
  return 'material';
}

async function main() {
  console.log(`模式：${APPLY ? '⚠️  APPLY（写库）' : '🔍 DRY-RUN（只读）'}`);
  console.log(`目标：${REMOTE_URL || '本地 SQLite'}`);

  if (REMOTE_URL) {
    // ---- 远端模式：走 topics/items/todos PATCH API ----
    const h = { 'X-API-Key': REMOTE_TOKEN || '', 'Content-Type': 'application/json' };
    const j = async (p) => {
      const r = await fetch(`${REMOTE_URL.replace(/\/$/, '')}${p}`, { headers: h });
      if (!r.ok) throw new Error(`${p} → HTTP ${r.status}`);
      return r.json();
    };

    // 1. 建核心主题
    let created = 0;
    for (const t of CORE_TOPICS) {
      const r = await fetch(`${REMOTE_URL.replace(/\/$/, '')}/api/v1/topics`, {
        method: 'POST', headers: h,
        body: JSON.stringify({ name: t.name, icon: t.icon, default_line: t.default_line, sort_order: t.sort_order }),
      });
      if (r.status === 201) { created++; console.log(`  ＋ 主题「${t.name}」`); }
      else if (r.status === 409) { /* 已存在 */ }
      else console.warn(`  ？ 主题「${t.name}」HTTP ${r.status}`);
    }
    const { topics } = await j('/api/v1/topics');
    const byName = Object.fromEntries(topics.map((t) => [t.name, t]));

    // 2. 逐卡修 item_type / topic_id
    const { items } = await j('/api/v1/items?page_size=60&page=1');
    let typeFixed = 0, topicFixed = 0;
    for (const it of items) {
      const patch = {};
      const wantType = it.tags?.includes('发布包') ? 'bundle' : it.tags?.includes('选题') ? 'idea' : 'material';
      if (wantType !== (it.item_type || 'material')) { patch.item_type = wantType; }
      if (!it.topic_id) {
        const hit = topics.find((t) => it.tags?.includes(t.name));
        const target = hit || (it.line === 'media' ? byName['自媒体'] : null);
        if (target) patch.topic_id = target.id;
      }
      if (Object.keys(patch).length) {
        const r = await fetch(`${REMOTE_URL.replace(/\/$/, '')}/api/v1/items/${it.id}`, {
          method: 'PATCH', headers: h, body: JSON.stringify(patch),
        });
        if (r.ok) { typeFixed += patch.item_type ? 1 : 0; topicFixed += patch.topic_id ? 1 : 0; }
      }
    }
    console.log(`\n远端清洗完成：新主题 ${created}，item_type 修正 ${typeFixed}，topic 挂载 ${topicFixed}`);
    return;
  }

  // ---- 本地模式：直连 SQLite ----
  const { db } = await import('../src/db.js');
  db.exec('BEGIN');
  try {
    // 1. 核心主题
    for (const t of CORE_TOPICS) {
      db.prepare(
        `INSERT OR IGNORE INTO topics (name, slug, icon, default_line, sort_order) VALUES (?, ?, ?, ?, ?)`
      ).run(t.name, `core-${t.name}`, t.icon, t.default_line, t.sort_order);
    }
    const topics = db.prepare('SELECT id, name FROM topics').all();
    const byName = Object.fromEntries(topics.map((t) => [t.name, t.id]));
    console.log(`主题表：${topics.length} 个（${topics.map((t) => t.name).join('、')}）`);

    // 2. item_type
    const allItems = db.prepare('SELECT id, tags, raw_input, line, topic_id, item_type FROM items').all();
    const typeRows = [];
    for (const it of allItems) {
      let rawText = '';
      try { rawText = JSON.parse(it.raw_input || '{}').raw_text || ''; } catch {}
      const want = classifyType(it.tags, rawText);
      if (want !== (it.item_type || 'material')) typeRows.push([it.id, want, it]);
    }
    console.log(`\nitem_type 待修正：${typeRows.length} 张`);
    for (const [id, want, it] of typeRows.slice(0, 40)) console.log(`  - [${(it.item_type || 'material')}→${want}] ${String(JSON.parse(it.raw_input || '{}').id ? '' : '')}${id.slice(0, 8)}…`);

    // 3. topic_id
    const topicRows = [];
    for (const it of allItems) {
      if (it.topic_id) continue;
      let tags = [];
      try { tags = JSON.parse(it.tags || '[]'); } catch {}
      const hit = topics.find((t) => tags.includes(t.name));
      const target = hit || (it.line === 'media' ? byName['自媒体'] : null);
      if (target) topicRows.push([it.id, target.id, target.name]);
    }
    console.log(`\ntopic 挂载：${topicRows.length} 张`);
    const byTopic = {};
    for (const [, , name] of topicRows) byTopic[name] = (byTopic[name] || 0) + 1;
    for (const [name, c] of Object.entries(byTopic)) console.log(`  - 「${name}」× ${c}`);

    // 4. todos 继承
    const todoRows = db
      .prepare(`SELECT t.id, i.topic_id FROM todos t JOIN items i ON i.id = t.source_item_id WHERE t.topic_id IS NULL AND i.topic_id IS NOT NULL`)
      .all();
    console.log(`\ntodos 继承 topic：${todoRows.length} 条`);

    if (!APPLY) {
      db.exec('ROLLBACK');
      console.log('\n（dry-run 结束，未写入。确认后加 --apply）');
      return;
    }

    const su = db.prepare('UPDATE items SET item_type = ?, topic_id = ?, updated_at = ? WHERE id = ?');
    const now = new Date().toISOString();
    for (const it of allItems) {
      let rawText = '';
      try { rawText = JSON.parse(it.raw_input || '{}').raw_text || ''; } catch {}
      const want = classifyType(it.tags, rawText);
      let tags = [];
      try { tags = JSON.parse(it.tags || '[]'); } catch {}
      const hit = topics.find((t) => tags.includes(t.name));
      const target = hit || (it.line === 'media' ? byName['自媒体'] : null) || it.topic_id;
      su.run(want, target ?? null, now, it.id);
    }
    db.prepare(`UPDATE todos SET topic_id = (SELECT topic_id FROM items WHERE items.id = todos.source_item_id), updated_at = ? WHERE topic_id IS NULL AND source_item_id IS NOT NULL`).run(now);

    db.exec('COMMIT');
    console.log(`\n✅ 已写入：item_type 修正 ${typeRows.length}，topic 挂载 ${topicRows.length}，todos 继承 ${todoRows.length}`);
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('迁移失败：', e.message);
    process.exit(1);
  }
}

main().catch((e) => { console.error('失败：', e.message); process.exit(1); });
