// ===== /api/v1/agent — 面向 AI Agent 的自发现能力清单 =====
// Agent（Claude Code / Codex / 任意 OpenAI 兼容客户端）先请求本端点，
// 即可获得全部可操作端点、参数与枚举，无需阅读文档。

import { Router } from 'express';
import { llmConfigured } from '../services/agent.js';
import { CATEGORIES, CONTENT_TYPES, PRIORITIES, TODO_STATUSES, SOURCE_PLATFORMS } from '../constants.js';

export const agentRouter = Router();

agentRouter.get('/agent/capabilities', (req, res) => {
  res.json({
    name: 'InfoStation',
    version: '0.1.0',
    description: 'AI 驱动的个人信息处理中枢：录入 → Agent 清洗/分类/TODO 提取 → 知识卡片与行动清单',
    auth: process.env.API_TOKEN
      ? { required: true, header: 'Authorization: Bearer <token> 或 X-API-Key: <token>' }
      : { required: false, note: '未配置 API_TOKEN，接口开放（本地开发模式）' },
    agent_engine: {
      mode: llmConfigured() ? 'llm' : 'mock',
      model: llmConfigured() ? process.env.LLM_MODEL : null,
    },
    enums: {
      categories: CATEGORIES,           // 一级分类（目标领域）
      content_types: CONTENT_TYPES,     // 内容类型
      priorities: PRIORITIES,           // high | medium | low
      todo_statuses: TODO_STATUSES,     // pending | in_progress | done | archived
      source_platforms: SOURCE_PLATFORMS,
    },
    endpoints: [
      {
        method: 'POST', path: '/api/v1/process',
        summary: '核心：录入信息并交给 Agent 处理（自动提取卡片 + TODO）',
        body: {
          content: 'string 必填（URL 会自动抓取正文；文本/想法直接分析）',
          source_type: 'url | text | manual 可选，默认自动识别',
          preferred_category: 'enum(categories) 可选，预设分类',
          preferred_priority: 'enum(priorities) 可选，预设优先级',
          user_note: 'string 可选，用户备注',
        },
        returns: '{ processed_item, extracted_todos[], agent_mode }；重复内容返回 409',
      },
      {
        method: 'POST', path: '/api/v1/extract',
        summary: 'URL 抓取预览（不落库）：提取标题/正文/平台',
        body: { url: 'string 必填' },
      },
      {
        method: 'GET', path: '/api/v1/items',
        summary: '知识卡片列表（筛选/搜索/排序/分页）',
        query: {
          q: '全文搜索（标题/摘要/正文/标签）',
          category: 'enum(categories)', content_type: 'enum(content_types)',
          priority: 'enum(priorities)', platform: 'enum(source_platforms)',
          tag: '精确标签', has_todo: 'yes | no',
          sort: 'time | priority | related', page: '默认 1', page_size: '默认 24，最大 60',
        },
      },
      {
        method: 'GET', path: '/api/v1/items/:id',
        summary: '卡片详情（含 todos、关联内容）',
      },
      {
        method: 'PATCH', path: '/api/v1/items/:id',
        summary: '编辑卡片（标题/摘要/分类/类型/优先级/标签/全文）',
        body: { title: 'string', summary: 'string', primary_category: 'enum', content_type: 'enum', priority: 'enum', tags: 'string[]' },
      },
      { method: 'DELETE', path: '/api/v1/items/:id', summary: '删除卡片（级联删除其 TODO）' },
      {
        method: 'GET', path: '/api/v1/todos',
        summary: 'TODO 列表（视图筛选）',
        query: {
          view: 'today（今日+已到期待办，默认语义）| pending | done',
          category: 'enum(categories)', priority: 'enum(priorities)',
          status: 'enum(todo_statuses)', source_item_id: '按来源卡片过滤',
        },
      },
      {
        method: 'POST', path: '/api/v1/todos',
        summary: '手动创建 TODO',
        body: { title: 'string 必填', description: 'string', category: 'enum', priority: 'enum', actual_deadline: 'YYYY-MM-DD', source_item_id: '关联卡片' },
      },
      {
        method: 'PATCH', path: '/api/v1/todos/:id',
        summary: '更新 TODO（完成/进行中/归档/编辑/改期）',
        body: { status: 'enum(todo_statuses)', title: 'string', priority: 'enum', category: 'enum', actual_deadline: 'YYYY-MM-DD 或 null' },
      },
      { method: 'DELETE', path: '/api/v1/todos/:id', summary: '删除 TODO' },
      { method: 'GET', path: '/api/v1/stats', summary: '数据看板（总量/趋势7与30天/分类与平台分布/标签TOP10/完成率/目标进度）' },
      { method: 'GET', path: '/api/v1/weekly-report', summary: '本周周报（?refresh=1 重新生成）' },
      { method: 'GET', path: '/api/v1/weekly-reports', summary: '历史周报列表' },
      { method: 'GET', path: '/api/v1/settings', summary: '设置（目标偏好/Agent 状态/数据量）' },
      { method: 'PUT', path: '/api/v1/settings', summary: '保存目标领域偏好', body: { user_goals: 'enum(categories)[]' } },
      { method: 'GET', path: '/api/v1/export', summary: 'JSON 全量导出（备份）' },
      { method: 'GET', path: '/api/v1/export/markdown', summary: 'Markdown 知识归档导出' },
      { method: 'POST', path: '/api/v1/import', summary: 'JSON 备份导入', body: 'InfoStation 导出的完整 JSON' },
      { method: 'DELETE', path: '/api/v1/data', summary: '清空全部数据（危险操作）' },
    ],
  });
});
