// ===== LLM Agent（OpenAI 兼容接口）=====
// 通过后端代理调用 LLM，API Key 不暴露给前端。
// 未配置 key 或调用失败时，降级到规则引擎 Mock 模式。

import { buildSystemPrompt, buildUserPrompt } from '../prompts/simi.js';
import { mockAgent } from './mock-agent.js';
import {
  CATEGORIES,
  CONTENT_TYPES,
  PRIORITIES,
} from '../constants.js';

const CFG = () => ({
  baseUrl: (process.env.LLM_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''),
  apiKey: process.env.LLM_API_KEY || '',
  model: process.env.LLM_MODEL || 'deepseek-chat',
  timeout: Number(process.env.LLM_TIMEOUT_MS || 60000),
});

export function llmConfigured() {
  return Boolean(CFG().apiKey);
}

/** 剥离 markdown 围栏、截取 JSON 主体 */
function extractJson(text) {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function callLlm(system, user, useJsonFormat = true) {
  const { baseUrl, apiKey, model, timeout } = CFG();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.3,
  };
  if (useJsonFormat) body.response_format = { type: 'json_object' };
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/** 规范化 LLM 返回：字段校验 + 缺失补齐 */
function normalizeAgentResult(parsed, rawInput, opts, mode) {
  const fallback = mockAgent(rawInput, opts);
  const todos = Array.isArray(parsed?.todos)
    ? parsed.todos
        .filter((t) => t && typeof t.title === 'string' && t.title.trim())
        .slice(0, 8)
        .map((t) => ({
          title: String(t.title).trim().slice(0, 30),
          description: String(t.description || '').slice(0, 200),
          priority: pickEnum(t.priority, PRIORITIES, 'medium'),
          suggested_days: Number.isFinite(Number(t.suggested_days)) ? Number(t.suggested_days) : null,
        }))
    : [];

  const category = pickEnum(parsed?.primary_category, CATEGORIES, opts.preferredCategory || fallback.primary_category);

  return {
    title: String(parsed?.title || fallback.title).slice(0, 40),
    // v2.0：主题归属（字符串主题名，由 process.js 解析为 topic_id；新主题会自动建档）
    topic: parsed?.topic == null ? null : String(parsed.topic).trim().slice(0, 12) || null,
    summary: String(parsed?.summary || fallback.summary).slice(0, 150),
    key_points: (Array.isArray(parsed?.key_points) ? parsed.key_points : fallback.key_points)
      .map((k) => String(k).slice(0, 60))
      .slice(0, 5),
    full_content: String(parsed?.full_content || rawInput.raw_text || '').trim(),
    primary_category: category,
    secondary_category: pickEnum(parsed?.secondary_category, CONTENT_TYPES, fallback.secondary_category),
    content_type: pickEnum(parsed?.content_type, CONTENT_TYPES, fallback.content_type),
    tags: (Array.isArray(parsed?.tags) ? parsed.tags : fallback.tags)
      .map((t) => String(t).trim().slice(0, 20))
      .filter(Boolean)
      .slice(0, 5),
    priority: pickEnum(parsed?.priority, PRIORITIES, opts.preferredPriority || fallback.priority),
    todos: todos.map((t) => ({ ...t, category })),
    related_keywords: (Array.isArray(parsed?.related_keywords) ? parsed.related_keywords : [])
      .map((k) => String(k).slice(0, 20))
      .slice(0, 5),
    agent_note: String(parsed?.agent_note || '').slice(0, 200),
    agent_confidence: Number.isFinite(Number(parsed?.agent_confidence))
      ? Math.min(Math.max(Number(parsed?.agent_confidence), 0), 1)
      : 0.85,
    agent_mode: mode,
  };
}

/**
 * Agent 主入口
 * @param {object} rawInput RawInput
 * @param {object} opts { preferredCategory, preferredPriority, userGoals, userContext, existingTags, line }
 */
export async function runAgent(rawInput, opts = {}) {
  if (!llmConfigured()) {
    return mockAgent(rawInput, opts);
  }

  const system = buildSystemPrompt({
    userGoals: opts.userGoals,
    existingTags: opts.existingTags || [],
    line: opts.line || 'trial',
    topics: opts.topics || [],
  });
  const user = buildUserPrompt(rawInput, opts.userContext);

  // 最多两次：第二次不带 response_format（部分网关不支持）
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const content = await callLlm(system, user, attempt === 0);
      const parsed = extractJson(content);
      if (!parsed) throw new Error('LLM 返回内容无法解析为 JSON');
      return normalizeAgentResult(parsed, rawInput, opts, 'llm');
    } catch (err) {
      if (attempt === 1) {
        console.warn('[agent] LLM 调用失败，降级 Mock 模式:', err.message);
        const result = mockAgent(rawInput, opts);
        result.agent_note = `LLM 调用失败已降级规则引擎（${err.message.slice(0, 80)}）。${result.agent_note}`;
        return result;
      }
    }
  }
}
