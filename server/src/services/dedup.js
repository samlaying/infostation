// ===== 重复检测 =====
// PRD: 文本相似度 > 85% 视为重复。
// 实现：字符 bigram Jaccard 相似度，对比近 30 天条目（个人规模数据量下足够快）。

import { db } from '../db.js';

function bigrams(text) {
  const t = (text || '').replace(/\s+/g, '').toLowerCase();
  const set = new Set();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}

export function jaccardSimilarity(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/** 综合相似度：Jaccard 与包含度（交集/较短者）取较大值，捕捉互为包含的重复 */
export function similarity(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  const jaccard = inter / (A.size + B.size - inter);
  const containment = inter / Math.min(A.size, B.size);
  return Math.max(jaccard, containment);
}

/**
 * 在近 30 天 items 中查找与 text 高度相似（>0.85）的条目
 * @returns {{item: object, similarity: number} | null}
 */
export function findDuplicate(text) {
  if (!text || text.trim().length < 20) return null;
  const rows = db
    .prepare(
      `SELECT id, title, full_content, source_url FROM items
       WHERE created_at >= datetime('now', '-30 days')
       ORDER BY created_at DESC LIMIT 200`
    )
    .all();

  let best = null;
  for (const row of rows) {
    // 取「与正文相似」和「与标题相似」的较大值，避免标题参与拼接稀释相似度
    const sim = Math.max(
      similarity(text, row.full_content),
      similarity(text, row.title)
    );
    if (sim > 0.85 && (!best || sim > best.similarity)) {
      best = { item: row, similarity: sim };
    }
  }
  return best;
}
