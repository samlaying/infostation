// ===== /api/v1/settings — 用户偏好 & Agent 状态（不含 API Key）=====

import { Router } from 'express';
import { db, getSetting, setSetting } from '../db.js';
import { llmConfigured } from '../services/agent.js';
import { CATEGORIES } from '../constants.js';

export const settingsRouter = Router();

settingsRouter.get('/settings', (req, res) => {
  res.json({
    user_goals: getSetting('user_goals', ['career', 'media', 'sidehustle']),
    agent_mode: llmConfigured() ? 'llm' : 'mock',
    auth_required: Boolean(process.env.API_TOKEN),
    llm: {
      configured: llmConfigured(),
      base_url: process.env.LLM_BASE_URL || 'https://api.deepseek.com',
      model: process.env.LLM_MODEL || 'deepseek-chat',
      // key 永不返回，只返回掩码提示
      key_hint: llmConfigured() ? '已配置（配置于服务端 .env）' : '未配置（当前为规则引擎 Mock 模式）',
    },
    counts: {
      items: db.prepare('SELECT COUNT(*) c FROM items').get().c,
      todos: db.prepare('SELECT COUNT(*) c FROM todos').get().c,
      reports: db.prepare('SELECT COUNT(*) c FROM weekly_reports').get().c,
    },
  });
});

settingsRouter.put('/settings', (req, res) => {
  const { user_goals } = req.body || {};
  if (Array.isArray(user_goals)) {
    const valid = user_goals.filter((g) => CATEGORIES.includes(g));
    if (valid.length) setSetting('user_goals', valid);
  }
  res.json({ ok: true, user_goals: getSetting('user_goals', ['career', 'media', 'sidehustle']) });
});
