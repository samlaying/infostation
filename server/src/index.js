// ===== InfoStation API 服务入口 =====

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processRouter } from './routes/process.js';
import { itemsRouter } from './routes/items.js';
import { todosRouter } from './routes/todos.js';
import { extractRouter } from './routes/extract.js';
import { statsRouter } from './routes/stats.js';
import { weeklyRouter } from './routes/weekly.js';
import { settingsRouter } from './routes/settings.js';
import { backupRouter } from './routes/backup.js';
import { agentRouter } from './routes/agent.js';
import { topicsRouter } from './routes/topics.js';
import { assetsRouter, postsRouter } from './routes/assets.js';
import { eventsRouter } from './routes/events.js';
import { requireToken } from './middleware/auth.js';
import { llmConfigured } from './services/agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: '5mb' })); // 导入备份可能较大

const api = express.Router();
api.use(requireToken); // 配置 API_TOKEN 后强制鉴权（见 middleware/auth.js）
api.use(agentRouter);
api.use(topicsRouter);
api.use(assetsRouter);
api.use(postsRouter);
api.use(processRouter);
api.use(itemsRouter);
api.use(todosRouter);
api.use(extractRouter);
api.use(statsRouter);
api.use(weeklyRouter);
api.use(settingsRouter);
api.use(backupRouter);
api.use(eventsRouter); // SSE 变更推送（GET /api/v1/events）
app.use('/api/v1', api);

// ===== 生产模式：托管前端构建产物（client/dist），SPA 回退到 index.html =====
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(path.join(STATIC_DIR, 'index.html'))) {
  app.use(express.static(STATIC_DIR));
  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.sendFile(path.join(STATIC_DIR, 'index.html'));
  });
  console.log(`[InfoStation] 静态前端已挂载: ${STATIC_DIR}`);
}

// 统一错误处理
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || '服务内部错误' });
});

app.listen(PORT, () => {
  console.log(`[InfoStation] API 服务已启动: http://localhost:${PORT}/api/v1`);
  console.log(`[InfoStation] Agent 模式: ${llmConfigured() ? 'LLM（' + (process.env.LLM_MODEL || 'deepseek-chat') + '）' : '规则引擎 Mock（未配置 LLM_API_KEY）'}`);
  console.log(`[InfoStation] API 鉴权: ${process.env.API_TOKEN ? '已启用（API_TOKEN）' : '开放（未配置 API_TOKEN）'}`);
});
