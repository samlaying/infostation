// ===== /api/v1/agent-jobs — 预处理任务：查询 / 本地 worker 认领 / 回传 / 重跑 =====
// CLI worker（用户 Mac）通过 claim → 执行 ego-browser / gh → complete 回传，
// 截图等二进制产物走 base64 上传，落 server/data/uploads/ 并登记 assets。

import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { db, rowToAsset } from '../db.js';
import { claimLocalStep, completeStep, listJobs, runPipeline } from '../orchestrator/worker.js';
import { broadcast } from '../services/events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const agentJobsRouter = Router();

// ---- 任务列表（前端 Inspector 进度面板）----
agentJobsRouter.get('/agent-jobs', (req, res) => {
  res.json({
    jobs: listJobs({
      item_id: req.query.item_id,
      status: req.query.status,
      limit: Number(req.query.limit) || 20,
    }),
  });
});

// ---- 本地 worker 认领下一个可执行的 local 步 ----
// ?caps=browser,gh 声明本机能力；无可领任务返回 { job: null }
agentJobsRouter.get('/agent-jobs/claim', (req, res) => {
  const caps = String(req.query.caps || '').split(',').map((s) => s.trim()).filter(Boolean);
  res.json(claimLocalStep(caps));
});

// ---- 重跑某张卡的预处理（配置好 Tavily key 后补跑调研等场景）----
agentJobsRouter.post('/agent-jobs/reprocess/:itemId', (req, res) => {
  const id = runPipeline(req.params.itemId, 'manual');
  if (!id) return res.status(400).json({ error: '没有可执行的预处理计划（或已有任务在进行中）' });
  res.status(201).json({ ok: true, job_id: id });
});

const EXT_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * 保存 base64 产物 → 静态文件 + assets 表登记。
 * 文件名用随机 UUID（不可枚举）；/uploads 目录挂载在 API 之外、无鉴权——
 * 与整个前端同为 HTTP，靠不可猜测文件名兜底（若上 HTTPS+鉴权可再收紧）。
 */
function saveUpload(itemId, upload, assetType, meta = {}) {
  const ext = EXT_MIME[upload.mime] || path.extname(upload.filename || '').replace('.', '') || 'png';
  const fname = `${randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, fname), Buffer.from(upload.content_b64, 'base64'));
  const info = db
    .prepare(
      `INSERT INTO assets (item_id, asset_type, local_path, remote_url, source_url, prompt, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      itemId,
      assetType,
      upload.local_path || null, // 本地 worker 机器上的原始路径（留档）
      `/uploads/${fname}`,
      meta.source_url || null,
      meta.prompt || null,
      JSON.stringify(meta.metadata || {})
    );
  broadcast('assets', 'create', itemId);
  return rowToAsset(db.prepare('SELECT * FROM assets WHERE id = ?').get(Number(info.lastInsertRowid)));
}

// ---- 回传步骤结果 ----
// body: { ok, result?, error?, upload?: { filename, mime, content_b64, local_path } }
agentJobsRouter.post('/agent-jobs/:id/steps/:idx/complete', (req, res) => {
  const { ok = true, result = null, error = null, upload = null } = req.body || {};
  let asset = null;
  try {
    // 产物上传（截图等）：先落库 asset，再把 asset 信息并入 result
    if (ok && upload?.content_b64) {
      const job = db.prepare('SELECT item_id FROM agent_jobs WHERE id = ?').get(Number(req.params.id));
      if (!job) return res.status(404).json({ error: '任务不存在' });
      const step = JSON.parse(
        db.prepare('SELECT skills_plan FROM agent_jobs WHERE id = ?').get(Number(req.params.id)).skills_plan
      )[Number(req.params.idx)];
      asset = saveUpload(job.item_id, upload, step?.skill === 'browser_screenshot' ? 'screenshot' : 'upload', {
        source_url: step?.params?.url,
        prompt: `preexec:${step?.skill}`,
      });
    }
    const merged = asset ? { ...(result || {}), asset_id: asset.id, asset_url: asset.remote_url } : result;
    const job = completeStep(Number(req.params.id), Number(req.params.idx), { ok, result: merged, error });
    res.json({ ok: true, job, asset });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
