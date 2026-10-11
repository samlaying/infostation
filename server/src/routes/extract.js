// ===== /api/v1/extract — URL 解析（独立入口，供前端预览抓取结果）=====

import { Router } from 'express';
import { extractUrl } from '../services/extractor.js';
import { isUrl } from '../constants.js';

export const extractRouter = Router();

extractRouter.post('/extract', async (req, res, next) => {
  try {
    const { url } = req.body || {};
    if (!url || !isUrl(String(url))) {
      return res.status(400).json({ error: '请提供合法的 URL（http/https）' });
    }
    const result = await extractUrl(String(url).trim());
    if (!result.ok) {
      return res.status(422).json({ error: result.error, tip: result.tip, platform: result.platform });
    }
    res.json({ ok: true, platform: result.platform, data: result.data });
  } catch (err) {
    next(err);
  }
});
