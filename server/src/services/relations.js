// ===== 卡片自动关联（tag_overlap）=====
// 激活 item_relations：新卡入库后，在同主题下找 ≥2 个相同标签的最近 N 张卡，
// 双向写入 item_relations（relation_type='tag_overlap'）。
// 显式血缘走 items.parent_item_id；这里只做横向灵感关联。

import { nanoid } from 'nanoid';
import { db } from '../db.js';

/**
 * 为一张卡片建立 tag_overlap 关联。
 * @param {string} itemId 新入库卡片 id
 * @param {object} opts { limit: 最多关联几张（默认 5） }
 * @returns {number} 建立的关联对数
 */
export function linkByTagOverlap(itemId, { limit = 5 } = {}) {
  const self = db.prepare('SELECT id, topic_id, tags FROM items WHERE id = ?').get(itemId);
  if (!self || !self.topic_id) return 0; // 无主题归属不做横向关联（噪音大于价值）

  let selfTags = [];
  try { selfTags = JSON.parse(self.tags || '[]'); } catch { /* 无标签 */ }
  if (selfTags.length < 2) return 0; // 自己标签不足 2 个，不可能有 ≥2 交集

  // 候选：同主题、非自身、未建立过关联（任一方向）
  const candidates = db
    .prepare(
      `SELECT i.id, i.tags FROM items i
       WHERE i.topic_id = ? AND i.id != ?
         AND NOT EXISTS (SELECT 1 FROM item_relations r
                         WHERE (r.item_id = i.id AND r.related_item_id = ?)
                            OR (r.item_id = ? AND r.related_item_id = i.id))
       ORDER BY i.created_at DESC
       LIMIT 200`
    )
    .all(self.topic_id, itemId, itemId, itemId);

  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO item_relations (id, item_id, related_item_id, relation_type, created_at)
     VALUES (?, ?, ?, 'tag_overlap', ?)`
  );

  let pairs = 0;
  for (const c of candidates) {
    if (pairs >= limit) break;
    let cTags = [];
    try { cTags = JSON.parse(c.tags || '[]'); } catch { continue; }
    const overlap = selfTags.filter((t) => cTags.includes(t));
    if (overlap.length < 2) continue;
    // 双向写入：两张卡的详情页/related_count 都能看到对方
    insert.run(nanoid(), itemId, c.id, now);
    insert.run(nanoid(), c.id, itemId, now);
    pairs++;
  }
  return pairs;
}
