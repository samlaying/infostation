// ===== 示例数据种子 =====
// 用法: cd server && npm run seed
// 灌入 14 条跨分类/跨平台示例信息 + TODO，让看板/周报开箱即有内容。

import 'dotenv/config';
import { nanoid } from 'nanoid';
import { db, transaction } from '../src/db.js';

const SEED_ITEMS = [
  {
    title: '小红书爆款标题的 4 个公式',
    summary: '爆款标题核心是「具体数字 + 情绪钩子 + 利益点」。数字标题打开率高出 37%，疑问式标题适合干货类，悬念式适合故事类。',
    key_points: ['数字前置：「3 个方法」比「几个方法」打开率高 37%', '情绪词：救命/绝了/后悔没早知道', '利益点必须落在标题后半句'],
    category: 'media', type: 'tutorial', tags: ['小红书运营', '标题公式', '自媒体'],
    priority: 'high', platform: 'xhs', url: 'https://www.xiaohongshu.com/explore/demo1',
    days_ago: 0,
    todos: [
      { title: '整理 10 个对标爆款标题', desc: '从小红书收藏里挑出近 30 天高赞笔记，拆标题结构', priority: 'high', done: true },
      { title: '给自己的下篇笔记写 3 版标题', desc: '分别用数字式/疑问式/悬念式各写一版', priority: 'medium', done: false },
    ],
  },
  {
    title: 'STAR 法则写晋升述职报告',
    summary: '述职核心是用 STAR（情境-任务-行动-结果）框架量化成果。关键在结果必须有具体数字，避免空泛描述。',
    key_points: ['情境用「在 XX 项目中」开头', '行动动词用「主导/推动/搭建」', '结果必须有具体数字'],
    category: 'career', type: 'template', tags: ['述职', '职场', '沟通'],
    priority: 'high', platform: 'wechat', url: 'https://mp.weixin.qq.com/s/demo2',
    days_ago: 1,
    todos: [
      { title: '用 STAR 框架梳理本季度 3 个项目', desc: '每个项目提炼一句结果，带数字', priority: 'high', done: false },
    ],
  },
  {
    title: '2025 低门槛副业盘点：5 个可落地方向',
    summary: 'AI 代运营、小红书买手、知识付费分销、闲置变现、本地探店是当前门槛最低的 5 个方向，启动成本均 < 500 元。',
    key_points: ['AI 代运营：帮本地商家写文案，单条 50-200 元', '知识付费分销：佣金 30-50%', '先跑通一个再扩展'],
    category: 'sidehustle', type: 'case', tags: ['副业', '变现', 'AI工具'],
    priority: 'medium', platform: 'jike', url: null,
    days_ago: 1,
    todos: [
      { title: '注册小红书买手中心账号', desc: '先完成资质认证，观察选品广场', priority: 'medium', done: false },
      { title: '试用一个 AI 文案工具', desc: '对比豆包/Kimi 的营销文案效果', priority: 'low', done: false },
    ],
  },
  {
    title: '抖音起号冷启动策略',
    summary: '前 5 条视频决定账号标签。垂直度 > 完播率 > 互动率，先模仿对标账号的爆款结构，再逐步加入个人风格。',
    key_points: ['前 5 条视频必须同一垂类', '黄金 3 秒完播率决定流量池', '发布时间 18-22 点最佳'],
    category: 'media', type: 'tutorial', tags: ['抖音', '起号', '运营'],
    priority: 'medium', platform: 'web', url: 'https://example.com/douyin-guide',
    days_ago: 2,
    todos: [
      { title: '研究 3 个对标账号的内容策略', desc: '记录选题、开头、更新频率', priority: 'medium', done: false },
    ],
  },
  {
    title: 'AI 绘图工具横评：Midjourney vs SD vs 国产',
    summary: 'Midjourney 审美最强但需付费；Stable Diffusion 免费可商用但上手陡；国产工具（即梦/可灵）中文理解好，适合封面图快速产出。',
    key_points: ['商用封面图：国产工具性价比最高', '精细控制：SD + LoRA', 'MJ 适合概念图与灵感探索'],
    category: 'tools', type: 'tool', tags: ['AI工具', 'Midjourney', '设计'],
    priority: 'low', platform: 'twitter', url: 'https://x.com/demo5',
    days_ago: 3,
    todos: [
      { title: '试用即梦生成 3 张封面图', desc: '测中文提示词理解与出图速度', priority: 'low', done: false },
    ],
  },
  {
    title: '费曼学习法：把知识讲给外行听',
    summary: '学习的本质是输出。能否用大白话讲清楚，是检验理解深度的唯一标准。卡壳的地方就是知识盲区。',
    key_points: ['选概念 → 讲给外行 → 发现卡点 → 回炉简化', '输出倒逼输入', '每周讲透 1 个概念即可'],
    category: 'growth', type: 'insight', tags: ['学习', '认知', '费曼'],
    priority: 'low', platform: 'manual', url: null,
    days_ago: 4,
    todos: [],
  },
  {
    title: '个人品牌定位：一句话说清你是谁',
    summary: '定位公式 = 我帮【谁】用【什么方法】解决【什么问题】。定位语不超过 20 字，出现在所有平台简介里。',
    key_points: ['三要素：人群 + 方法 + 问题', '定位语 ≤ 20 字', '所有平台简介统一'],
    category: 'media', type: 'template', tags: ['个人品牌', '定位', '自媒体'],
    priority: 'high', platform: 'podcast', url: null,
    days_ago: 4,
    todos: [
      { title: '完成个人定位语初稿', desc: '按公式写 3 版，选 1 版发朋友圈测试反馈', priority: 'high', done: false, deadline_days: 3 },
    ],
  },
  {
    title: '向上管理：如何让老板看到你的产出',
    summary: '定期主动汇报 > 年终突击。每周一封 3 句话周报邮件：做了什么、结果如何、下周计划。',
    key_points: ['周报三段式：结果 + 数据 + 计划', '坏消息早说，带解决方案', '让老板做选择题不是问答题'],
    category: 'career', type: 'insight', tags: ['职场', '向上管理', '汇报'],
    priority: 'medium', platform: 'wechat', url: 'https://mp.weixin.qq.com/s/demo8',
    days_ago: 5,
    todos: [
      { title: '建立每周五发周报的习惯', desc: '模板：结果/数据/下周计划，3 句话以内', priority: 'medium', done: true },
    ],
  },
  {
    title: 'Notion 数据库入门：从表格到看板',
    summary: 'Notion 数据库 = 表格 + 视图。同一份数据可以有表格/看板/日历/画廊多种视图，适合个人项目管理。',
    key_points: ['database 是核心，视图只是皮肤', 'filter + sort 组合出定制视图', 'relation 连接多个数据库'],
    category: 'tools', type: 'tutorial', tags: ['Notion', '效率工具', '教程'],
    priority: 'low', platform: 'web', url: 'https://notion.so/help',
    days_ago: 6,
    todos: [
      { title: '用 Notion 搭一个阅读追踪库', desc: '字段：书名/状态/评分/笔记链接', priority: 'low', done: true },
    ],
  },
  {
    title: '睡眠与专注力：90 分钟周期法',
    summary: '人以 90 分钟为周期波动精力。白天按 90 分钟工作 + 20 分钟休息切片，比番茄钟更符合生理节律。',
    key_points: ['90min 工作 + 20min 休息', '午后低谷安排机械性任务', '晚间避免高强度决策'],
    category: 'growth', type: 'data', tags: ['效率', '专注力', '习惯'],
    priority: 'low', platform: 'jike', url: null,
    days_ago: 8,
    todos: [],
  },
  {
    title: '播客变现路径：从 0 到接商单',
    summary: '播客变现三阶段：500 收听 → 平台补贴；3000 收听 → 品牌口播；1 万收听 → 定制单期。垂类播客单粉价值高于泛娱乐。',
    key_points: ['垂类 > 泛娱乐', '先做 20 期再谈变现', '商单报价 ≈ 收听数 × 0.5-1 元'],
    category: 'sidehustle', type: 'data', tags: ['播客', '变现', '副业'],
    priority: 'medium', platform: 'podcast', url: null,
    days_ago: 10,
    todos: [
      { title: '列一份播客选题清单（10 期）', desc: '围绕个人定位的垂类选题', priority: 'medium', done: false },
    ],
  },
  {
    title: '简历量化公式：动作 + 载体 + 结果',
    summary: '每条经历都应该是「通过 X 方法，在 Y 时间，实现 Z 结果」。Z 必须可量化，没有数字就创造参照系。',
    key_points: ['动词开头：主导/搭建/优化', '结果带数字或百分比', '没有绝对数就用相对变化'],
    category: 'career', type: 'template', tags: ['简历', '求职', '职场'],
    priority: 'medium', platform: 'xhs', url: null,
    days_ago: 12,
    todos: [
      { title: '按量化公式重写简历 3 条经历', desc: '每条控制在 2 行以内', priority: 'medium', done: true },
    ],
  },
  {
    title: '设计心理学：峰终定律在产品中的应用',
    summary: '用户对体验的记忆由峰值时刻和结束时刻决定。把资源集中在打造 1 个峰值 + 1 个完美结尾，优于平均用力。',
    key_points: ['峰值 + 终值决定记忆', '入职/开箱/完成时刻是天然的峰值机会', '负面时刻及时补偿可转粉'],
    category: 'growth', type: 'insight', tags: ['设计心理学', '产品', '认知'],
    priority: 'low', platform: 'manual', url: null,
    days_ago: 15,
    todos: [],
  },
  {
    title: '跨境出海：独立站选品的 3 个信号',
    summary: 'Google Trends 上升期、TikTok 相关标签播放量破千万、竞品评论里有未被满足的需求——三个信号同时出现再入场。',
    key_points: ['趋势上升期入场，成熟期慎入', '社媒热度是先行指标', '差评里藏选品机会'],
    category: 'sidehustle', type: 'insight', tags: ['跨境', '出海', '选品'],
    priority: 'medium', platform: 'web', url: 'https://example.com/cross-border',
    days_ago: 20,
    todos: [
      { title: '用 Google Trends 验证 2 个选品方向', desc: '看近 12 个月趋势曲线', priority: 'low', done: false },
    ],
  },
];

function seed() {
  const count = db.prepare('SELECT COUNT(*) c FROM items').get().c;
  if (count > 0) {
    console.log(`[seed] 数据库已有 ${count} 条数据，跳过种子。（如需重置：npm run seed -- --force 或先清空数据）`);
    if (!process.argv.includes('--force')) process.exit(0);
  }

  const insertItem = db.prepare(`
    INSERT INTO items (id, title, summary, key_points, full_content, raw_input,
      primary_category, secondary_category, content_type, tags, priority,
      source_type, source_platform, source_url, source_author,
      agent_confidence, agent_note, created_at, processed_at)
    VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, 'url', ?, ?, '示例作者', 0.9, ?, ?, ?)
  `);
  const insertTodo = db.prepare(`
    INSERT INTO todos (id, title, description, source_item_id, source_summary,
      category, priority, status, suggested_deadline, actual_deadline, tags, created_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  transaction(() => {
    for (const s of SEED_ITEMS) {
      const itemId = nanoid();
      const created = new Date(Date.now() - s.days_ago * 86400000 - 3600000).toISOString();
      insertItem.run(
        itemId, s.title, s.summary, JSON.stringify(s.key_points),
        [s.title, s.summary, ...s.key_points].join('\n'),
        s.category, s.type, s.type, JSON.stringify(s.tags), s.priority,
        s.platform, s.url,
        '（示例数据）由「私秘」Agent 处理',
        created, created
      );
      for (const t of s.todos) {
        const tid = nanoid();
        const tCreated = new Date(Date.now() - s.days_ago * 86400000).toISOString();
        const deadline = new Date(Date.now() + (t.deadline_days || 4) * 86400000).toISOString().slice(0, 10);
        const doneAt = t.done ? new Date(Date.now() - s.days_ago * 43200000).toISOString() : null;
        insertTodo.run(
          tid, t.title, t.desc, itemId, s.summary.slice(0, 100),
          s.category, t.priority,
          t.done ? 'done' : 'pending',
          deadline, t.done ? deadline : null,
          JSON.stringify(s.tags.slice(0, 2)),
          tCreated, doneAt
        );
      }
    }
  })();

  const items = db.prepare('SELECT COUNT(*) c FROM items').get().c;
  const todos = db.prepare('SELECT COUNT(*) c FROM todos').get().c;
  console.log(`[seed] 完成：${items} 条信息，${todos} 条 TODO。`);
  process.exit(0);
}

seed();
