// ===== GET /api/v1/events — SSE 实时变更推送 =====
// 鉴权走 requireToken（EventSource 无法带 header，auth 中间件支持 ?token= 查询参数）。
// 断线由浏览器 EventSource 自动重连（retry: 3000）；25s 心跳防代理空闲断开。

import { Router } from 'express';
import { subscribe } from '../services/events.js';

export const eventsRouter = Router();

eventsRouter.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx 反代下禁用缓冲，事件即时到达
  });
  res.write('retry: 3000\n\n');

  const unsubscribe = subscribe((event) => {
    res.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
  });

  // 心跳注释行：保持连接活跃，同时给客户端确认链路活着
  const heartbeat = setInterval(() => {
    res.write(`: ping ${Date.now()}\n\n`);
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
