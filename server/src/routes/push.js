// ===== /api/v1/push — 主动推动（v2.5）=====
// GET    /push              当前待处理建议（默认 status=new）
// POST   /push/generate     生成一批（force=true 忽略当日已生成）
// POST   /push/:id/accept   采纳 → 返回下一步动作（落库仍走既有 process/todos）
// POST   /push/:id/dismiss  忽略
// GET    /push/eyewash      今日洗眼睛站点（前端可单独取，不依赖已生成批次）

import { Router } from 'express';
import {
  generatePush, listSuggestions, acceptSuggestion, dismissSuggestion, todayEyewash,
} from '../services/push.js';

export const pushRouter = Router();

pushRouter.get('/push', (req, res) => {
  const status = ['new', 'accepted', 'dismissed', 'expired', 'all'].includes(req.query.status)
    ? req.query.status
    : 'new';
  res.json({
    suggestions: listSuggestions({ status, limit: Number(req.query.limit) || 30 }),
    eyewash: todayEyewash(),
  });
});

pushRouter.get('/push/eyewash', (req, res) => {
  res.json(todayEyewash());
});

pushRouter.post('/push/generate', async (req, res) => {
  try {
    const result = await generatePush({ force: Boolean(req.body?.force) });
    res.status(result.skipped ? 200 : 201).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

pushRouter.post('/push/:id/accept', (req, res) => {
  try {
    res.json(acceptSuggestion(req.params.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

pushRouter.post('/push/:id/dismiss', (req, res) => {
  try {
    res.json(dismissSuggestion(req.params.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
