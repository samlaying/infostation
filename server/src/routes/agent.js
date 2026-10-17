// ===== /api/v1/agent — 面向 AI Agent 的自发现能力清单 =====
// Agent（Claude Code / Codex / 任意 OpenAI 兼容客户端）先请求本端点，
// 即可获得全部可操作端点、参数与枚举，无需阅读文档。

import { Router } from 'express';
import { llmConfigured } from '../services/agent.js';
import {
  CATEGORIES, CONTENT_TYPES, PRIORITIES, TODO_STATUSES, SOURCE_PLATFORMS,
  LINES, ITEM_TYPES, ASSET_TYPES, POST_PLATFORMS, POST_STATUSES,
} from '../constants.js';

export const agentRouter = Router();

agentRouter.get('/agent/capabilities', (req, res) => {
  res.json({
    name: 'InfoStation',
    version: '0.2.0',
    description:
      'AI 驱动的个人信息处理中枢：录入 → Agent 清洗/分类/TODO 提取 → 知识卡片与行动清单。' +
      '双线设计：trial(TODO线，值得试的东西→行动) / media(自媒体线，话题素材→内容生产)。' +
      'v2.0 数据模型：topics(主题=目标，一等公民) → items(素材→选题→发布包血缘树) → assets(截图/生图) → posts(多平台帖子与发布回执)',
    auth: process.env.API_TOKEN
      ? { required: true, header: 'Authorization: Bearer <token> 或 X-API-Key: <token>' }
      : { required: false, note: '未配置 API_TOKEN，接口开放（本地开发模式）' },
    agent_engine: {
      mode: llmConfigured() ? 'llm' : 'mock',
      model: llmConfigured() ? process.env.LLM_MODEL : null,
    },
    enums: {
      lines: LINES,                     // 产品线：trial(TODO线) | media(自媒体线)；默认 trial
      categories: CATEGORIES,           // 一级分类（目标领域）
      content_types: CONTENT_TYPES,     // 内容类型
      priorities: PRIORITIES,           // high | medium | low
      todo_statuses: TODO_STATUSES,     // pending | in_progress | done | archived
      source_platforms: SOURCE_PLATFORMS,
      media_role_tags: ['素材', '选题', '发布包', '已发布'],  // 自媒体线卡片角色（用 tags 表达，兼容旧约定）
      item_types: ITEM_TYPES,           // v2.0 卡片角色：material(素材/普通卡) | idea(选题) | bundle(发布包)
      asset_types: ASSET_TYPES,         // v2.0 资产：screenshot | ai_image | upload | video
      post_platforms: POST_PLATFORMS,   // v2.0 帖子平台
      post_statuses: POST_STATUSES,     // v2.0 帖子状态机
    },
    endpoints: [
      {
        method: 'POST', path: '/api/v1/process',
        summary: '核心：录入信息并交给 Agent 处理（自动提取卡片 + TODO；v2.0 起 Agent 自动识别主题并继承）',
        body: {
          content: 'string 必填（URL 会自动抓取正文；文本/想法直接分析）',
          source_type: 'url | text | manual 可选，默认自动识别',
          preferred_category: 'enum(categories) 可选，预设分类',
          preferred_priority: 'enum(priorities) 可选，预设优先级',
          user_note: 'string 可选，用户备注',
          line: 'enum(lines) 可选，默认 trial。trial=值得试的东西→行动TODO；media=话题/素材→内容工序',
        },
        returns: '{ processed_item, extracted_todos[], agent_mode }；重复内容返回 409；Agent 自动绑定 topic_id（新主题自动建档）',
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
          line: 'enum(lines) 按产品线过滤（trial | media）',
          tag: '精确标签（媒体线角色：素材/选题/发布包/已发布）', has_todo: 'yes | no',
          topic_id: 'number 按主题过滤（v2.0）', item_type: 'enum(item_types) 按卡片角色过滤（v2.0）',
          sort: 'time | priority | related', page: '默认 1', page_size: '默认 24，最大 60',
        },
      },
      {
        method: 'GET', path: '/api/v1/items/:id',
        summary: '卡片详情（含 todos、关联内容；v2.0 起 related_items 含 tag_overlap 自动关联）',
      },
      {
        method: 'PATCH', path: '/api/v1/items/:id',
        summary: '编辑卡片（标题/摘要/分类/类型/优先级/标签/全文/换线/主题/角色/血缘）',
        body: {
          title: 'string', summary: 'string', primary_category: 'enum', content_type: 'enum',
          priority: 'enum', tags: 'string[]', line: 'enum(lines)',
          topic_id: 'number|null（v2.0；改动会经触发器自动同步名下 todos 的 line/topic_id）',
          item_type: 'enum(item_types)',
          parent_item_id: 'string|null 血缘外键：bundle→idea→material',
        },
      },
      { method: 'DELETE', path: '/api/v1/items/:id', summary: '删除卡片（级联删除其 TODO/资产/帖子）' },
      {
        method: 'GET', path: '/api/v1/todos',
        summary: 'TODO 列表（视图筛选）',
        query: {
          view: 'today（今日+已到期待办，默认语义）| pending | done',
          category: 'enum(categories)', priority: 'enum(priorities)',
          status: 'enum(todo_statuses)', source_item_id: '按来源卡片过滤',
          line: 'enum(lines) 按产品线过滤：trial(行动项) | media(内容工序)',
          topic_id: 'number 按主题过滤（v2.0）',
        },
      },
      {
        method: 'POST', path: '/api/v1/todos',
        summary: '手动创建 TODO',
        body: { title: 'string 必填', description: 'string', category: 'enum', priority: 'enum', actual_deadline: 'YYYY-MM-DD', source_item_id: '关联卡片', line: 'enum(lines) 可选，缺省继承来源卡片的线，再缺省 trial' },
      },
      {
        method: 'PATCH', path: '/api/v1/todos/:id',
        summary: '更新 TODO（完成/进行中/归档/编辑/改期/换线）',
        body: { status: 'enum(todo_statuses)', title: 'string', priority: 'enum', category: 'enum', actual_deadline: 'YYYY-MM-DD 或 null', line: 'enum(lines)' },
      },
      { method: 'DELETE', path: '/api/v1/todos/:id', summary: '删除 TODO' },
      {
        method: 'GET', path: '/api/v1/topics',
        summary: 'v2.0 主题列表（一等公民：主题=目标；含 item_count/todo_count/last_active_at，支撑「7 天荒废」提醒）',
        query: { status: 'active | archived' },
      },
      {
        method: 'POST', path: '/api/v1/topics',
        summary: 'v2.0 新建主题',
        body: { name: 'string 必填唯一', icon: 'string 默认📁', color: 'string', default_line: 'enum(lines) 默认trial', description: 'string 给 Agent 的主题提示', sort_order: 'number' },
      },
      {
        method: 'PATCH', path: '/api/v1/topics/:id',
        summary: 'v2.0 更新主题（改名/图标/颜色/状态/排序/默认线/描述）',
        body: { name: 'string', icon: 'string', color: 'string', default_line: 'enum(lines)', status: 'active | archived', sort_order: 'number', description: 'string' },
      },
      { method: 'DELETE', path: '/api/v1/topics/:id', summary: 'v2.0 删除主题（卡片保留，topic_id 置空）' },
      {
        method: 'GET', path: '/api/v1/assets',
        summary: 'v2.0 资产列表（Agent 截图/生图/上传）',
        query: { item_id: '按卡片过滤', todo_id: '按工序过滤', type: 'enum(asset_types)' },
      },
      {
        method: 'POST', path: '/api/v1/assets',
        summary: 'v2.0 登记资产（本地 Agent 浏览器截图 / AI 生图 / 图床上传后回填 URL）',
        body: {
          item_id: 'string 必填', todo_id: 'string 可选（哪步工序产出）',
          asset_type: 'enum(asset_types) 必填',
          local_path: '本地路径（与 remote_url 至少一个）', remote_url: '图床/平台 URL',
          source_url: '截图源网页', prompt: '生图 Prompt', metadata: 'object（尺寸/说明等）',
        },
      },
      { method: 'PATCH', path: '/api/v1/assets/:id', summary: 'v2.0 更新资产（如上传后回填 remote_url）', body: { local_path: 'string', remote_url: 'string', prompt: 'string', metadata: 'object' } },
      { method: 'DELETE', path: '/api/v1/assets/:id', summary: 'v2.0 删除资产记录' },
      {
        method: 'GET', path: '/api/v1/posts',
        summary: 'v2.0 帖子列表（多平台发布产出）',
        query: { source_item_id: '按来源卡片过滤', topic_id: '按主题', platform: 'enum(post_platforms)', status: 'enum(post_statuses)' },
      },
      {
        method: 'POST', path: '/api/v1/posts',
        summary: 'v2.0 创建帖子草稿（整理好的平台专属文案 + 绑定资产顺序）',
        body: {
          source_item_id: 'string 必填（选题或素材卡）', topic_id: 'number 可选',
          platform: 'enum(post_platforms) 默认 xiaohongshu', title: 'string 必填',
          content_body: 'string', asset_ids: 'number[]（assets 表 id，决定配图顺序）',
        },
      },
      {
        method: 'PATCH', path: '/api/v1/posts/:id',
        summary: 'v2.0 更新帖子（状态机 draft→ready→publishing→published/failed；published 时回填回执）',
        body: { title: 'string', content_body: 'string', asset_ids: 'number[]', platform: 'enum', status: 'enum(post_statuses)', published_url: 'string（发布成功后的线上链接）' },
      },
      { method: 'DELETE', path: '/api/v1/posts/:id', summary: 'v2.0 删除帖子' },
      { method: 'GET', path: '/api/v1/stats', summary: '数据看板（总量/趋势7与30天/分类与平台分布/标签TOP10/完成率/目标进度；v2.0 todos 含 trial_count/media_count 分线口径）' },
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
