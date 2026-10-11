// ===== 规则引擎 Agent（Mock 模式）=====
// 未配置 LLM_API_KEY 时的降级实现：关键词分类 + 首句摘要 + 行动动词 TODO 提取。
// 输出结构与 LLM Agent 完全一致（agentResultSchema），前端无感知。

import { CATEGORIES, CONTENT_TYPES } from '../constants.js';

const CATEGORY_KEYWORDS = {
  career: ['职场', '晋升', '述职', '简历', '面试', '沟通', '管理', '领导', '同事', '汇报', '跳槽', '薪资', '加薪', '职场提升', 'pmp', '项目管理', '职场'],
  media: ['自媒体', '小红书', '涨粉', '选题', '爆款', '账号', '运营', '流量', '粉丝', '个人品牌', '内容创作', '抖音', '视频号', '公众号', '变现', '封面', '标题公式', '起号'],
  sidehustle: ['副业', '赚钱', '月入', '变现', '创业', '生意', '搞钱', '被动收入', '项目', '平台玩法', '案例拆解', '接单', '外包'],
  growth: ['认知', '思维', '模型', '心理学', '习惯', '读书', '笔记', '成长', '效率', '时间管理', '专注', '自律', '学习方法'],
  tools: ['工具', '软件', 'app', 'ai 工具', 'ai工具', 'notion', 'obsidian', 'chatgpt', 'claude', 'midjourney', '效率工具', '插件', '浏览器', '自动化', 'n8n', '工作流'],
  archive: ['资料', '参考', '素材', '存档', '收藏'],
};

const CONTENT_TYPE_KEYWORDS = {
  tutorial: ['教程', '步骤', '如何', '怎么', '指南', '方法', '实操', '手把手', '攻略', 'step'],
  case: ['案例', '经验', '分享', '我做', '踩坑', '复盘', '从 0', '从0'],
  data: ['数据', '报告', '增长', '调研', '统计', '比例', '%', '排行'],
  tool: ['推荐', '工具', '神器', '软件', '测评', '对比'],
  template: ['模板', '框架', '清单', 'checklist', 'sop', '话术'],
  insight: [],
};

// 行动动词（PRD 4.2.4 TODO 提取规则）
const ACTION_VERBS = ['注册', '下载', '安装', '试用', '学习', '研究', '写', '建立', '完成', '阅读', '读', '练习', '制定', '创建', '搭建', '优化', '复盘', '发布', '发布', '联系', '申请', '尝试', '配置', '整理', '拆解', '分析', '开通'];

function clamp(str, max) {
  if (!str) return '';
  return str.length <= max ? str : str.slice(0, max - 1) + '…';
}

/** 清洗：去水印/广告/多余空白 */
export function cleanText(text) {
  return (text || '')
    .replace(/(转发|赞|收藏|评论)\s*[\d·]*/g, '')
    .replace(/[#@][^\s#@]{1,30}/g, (m) => (m.length > 2 ? m + ' ' : ''))
    .replace(/——\s*来自.*$/gm, '')
    .replace(/(关注|下载).{0,8}(app|App|APP).{0,10}$/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitSentences(text) {
  return text
    .split(/[。！？!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 6);
}

function classifyCategory(text) {
  const scores = {};
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    scores[cat] = kws.reduce((acc, kw) => acc + (text.toLowerCase().includes(kw.toLowerCase()) ? 1 : 0), 0);
  }
  let best = 'archive';
  let bestScore = 0;
  for (const [cat, score] of Object.entries(scores)) {
    if (score > bestScore) {
      best = cat;
      bestScore = score;
    }
  }
  return { category: best, confidence: bestScore > 0 ? Math.min(0.6 + bestScore * 0.08, 0.92) : 0.5 };
}

function classifyContentType(text) {
  for (const [type, kws] of Object.entries(CONTENT_TYPE_KEYWORDS)) {
    if (kws.some((kw) => text.toLowerCase().includes(kw))) return type;
  }
  return 'insight';
}

function assessPriority(text, category) {
  if (/紧急|立即|马上|截止|今天|限时|重要/.test(text)) return 'high';
  if (/副业|变现|赚钱|晋升|面试/.test(text) || category === 'sidehustle') return 'medium';
  return 'low';
}

function extractTags(text, rawTags = []) {
  const fromContent = (text.match(/[#＃]([^\s#＃]{1,20})/g) || []).map((t) => t.replace(/[#＃]/, ''));
  const candidates = [...rawTags, ...fromContent];
  const seen = new Set();
  const tags = [];
  for (const t of candidates) {
    const k = t.trim();
    if (k && !seen.has(k)) {
      seen.add(k);
      tags.push(k);
    }
    if (tags.length >= 5) break;
  }
  return tags;
}

/** 从句子中提取行动型 TODO */
function extractTodosFromText(text, category) {
  const todos = [];
  // 句子 + 分号子句 + 「然后/逗号」动作子句
  const clauses = [
    ...splitSentences(text),
    ...text.split(/[;；]/),
    ...text.split(/然后|[，,]/),
  ]
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
  const seen = new Set();
  const candidates = [];
  for (const s of clauses) {
    const verb = ACTION_VERBS.find((v) => s.includes(v));
    if (!verb) continue;
    // 截取动词附近的片段作为 TODO 标题
    const idx = s.indexOf(verb);
    const frag = s.slice(idx, idx + 24).replace(/[，。,.！!？?；;、]/g, '');
    if (frag.length < 4) continue;
    const title = clamp(frag, 20);
    if (seen.has(title)) continue;
    seen.add(title);
    candidates.push({ title, source: s });
  }
  // 丢弃跨动作长片段：若某候选标题包含另一个更短的候选，视为切分噪音
  const filtered = candidates.filter(
    (c) => !candidates.some((o) => o !== c && o.title.length < c.title.length && c.title.includes(o.title))
  );
  for (const c of filtered) {
    if (todos.length >= 5) break;
    todos.push({
      title: c.title,
      description: clamp(c.source, 100),
      category,
      priority: 'medium',
    });
  }
  return todos;
}

/** 标题降噪：去掉「看到一篇…」等口语前缀 */
function deriveTitle(rawTitle, rawText) {
  if (rawTitle) return clamp(rawTitle, 30);
  const text = (rawText || '').trim();
  // 「…：正文」结构优先取冒号后
  const colonParts = text.split(/[：:]/);
  if (colonParts.length > 1 && colonParts[0].length <= 20) {
    const after = colonParts.slice(1).join('：').trim();
    if (after.length > 8) return clamp(after, 30);
  }
  const stripped = text.replace(/^(看到|刷到|读到|分享|转发)(一[篇条个张段])?(很|超|比较)?(好的?|不错|有用|棒)?的?(文章|视频|笔记|帖子|内容|干货)?[：:，,]?\s*/, '');
  const first = splitSentences(stripped)[0] || stripped;
  return clamp(first || text, 30);
}

/**
 * Mock Agent 主入口
 * @param {object} input 形如 RawInput（含 raw_text/raw_title/raw_url/source_platform 等）
 * @param {object} opts { preferredCategory?, preferredPriority?, userGoals? }
 */
export function mockAgent(input, opts = {}) {
  const rawText = cleanText(input.raw_text || '');
  const rawTitle = input.raw_title || '';
  const fullText = [rawTitle, rawText].filter(Boolean).join('\n');

  const { category, confidence } = classifyCategory(fullText);
  const finalCategory = CATEGORIES.includes(opts.preferredCategory) ? opts.preferredCategory : category;
  const contentType = classifyContentType(fullText);

  const sentences = splitSentences(rawText);
  const summarySrc = sentences.slice(0, 2).join('。') || rawText;
  const summary = clamp(summarySrc, 100);

  const title = deriveTitle(rawTitle, rawText) || '未命名信息';

  const keyPoints = sentences.slice(0, 3).map((s) => clamp(s, 50)).filter(Boolean);

  const tags = extractTags(fullText, input.raw_metadata?.topics || []);

  const priority = PRIORITY_ASSUMPTION(opts, fullText, finalCategory);

  const todos = extractTodosFromText(rawText, finalCategory).map((t) => ({
    ...t,
    priority: t.priority || priority,
  }));

  return {
    title,
    summary,
    key_points: keyPoints.length ? keyPoints : [clamp(summary, 50)],
    full_content: rawText,
    primary_category: finalCategory,
    secondary_category: contentType,
    content_type: contentType,
    tags: tags.length ? tags : [finalCategory === 'archive' ? '资料' : '待整理'],
    priority,
    todos,
    related_hints: [], // Mock 不做关联发现
    agent_note: '当前为规则引擎（Mock 模式）处理结果，配置 LLM_API_KEY 后将由「私秘」Agent 提供更精准的摘要与 TODO 提取。',
    agent_confidence: confidence,
    agent_mode: 'mock',
  };
}

function PRIORITY_ASSUMPTION(opts, text, category) {
  if (['high', 'medium', 'low'].includes(opts.preferredPriority)) return opts.preferredPriority;
  return assessPriority(text, category);
}
