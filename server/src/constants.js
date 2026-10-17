// ===== 领域枚举（与前端 client/src/constants/index.js 保持一致）=====

export const CATEGORIES = ['career', 'media', 'sidehustle', 'growth', 'tools', 'archive'];
export const CONTENT_TYPES = ['tutorial', 'insight', 'case', 'data', 'tool', 'template'];
export const PRIORITIES = ['high', 'medium', 'low'];
export const TODO_STATUSES = ['pending', 'in_progress', 'done', 'archived'];
export const RELATION_TYPES = ['same_topic', 'complementary', 'contradicting'];
export const SOURCE_TYPES = ['url', 'text', 'manual', 'import', 'clipper'];
export const SOURCE_PLATFORMS = ['xhs', 'twitter', 'jike', 'wechat', 'web', 'podcast', 'manual', 'other'];

// 产品线（正交于 category 的维度）
// trial = TODO 线：值得试的东西 → 结论 + 行动 TODO
// media = 自媒体线：话题/素材 → 选题库 + 内容工序 + 发布包
export const LINES = ['trial', 'media'];

export function isValidCategory(v) {
  return CATEGORIES.includes(v);
}
export function isValidContentType(v) {
  return CONTENT_TYPES.includes(v);
}
export function isValidPriority(v) {
  return PRIORITIES.includes(v);
}
export function isValidTodoStatus(v) {
  return TODO_STATUSES.includes(v);
}
export function isValidLine(v) {
  return LINES.includes(v);
}

// ===== 媒体线卡片角色（v2.0 起提纯为 items.item_type 结构字段，tags 约定保留兼容）=====
export const MEDIA_ROLE_TAGS = ['素材', '选题', '发布包', '已发布'];

// ===== v2.0：items.item_type —— 卡片在流水线中的角色 =====
// material 素材/普通卡 → idea 选题 → bundle 发布包（配合 parent_item_id 形成血缘树）
export const ITEM_TYPES = ['material', 'idea', 'bundle'];

export function isValidItemType(v) {
  return ITEM_TYPES.includes(v);
}

// ===== v2.0：资产与帖子枚举 =====
export const ASSET_TYPES = ['screenshot', 'ai_image', 'upload', 'video'];
export const POST_PLATFORMS = ['xiaohongshu', 'wechat', 'x', 'bilibili', 'zhihu'];
export const POST_STATUSES = ['draft', 'ready', 'publishing', 'published', 'failed'];

export function isValidAssetType(v) {
  return ASSET_TYPES.includes(v);
}
export function isValidPostPlatform(v) {
  return POST_PLATFORMS.includes(v);
}
export function isValidPostStatus(v) {
  return POST_STATUSES.includes(v);
}

/** 识别 URL 所属平台 */
export function detectPlatform(url) {
  if (!url) return 'web';
  const u = url.toLowerCase();
  if (u.includes('xiaohongshu.com') || u.includes('xhslink.com')) return 'xhs';
  if (u.includes('twitter.com') || u.includes('x.com') || u.includes('t.co')) return 'twitter';
  if (u.includes('okjike.com') || u.includes('jike')) return 'jike';
  if (u.includes('weixin.qq.com') || u.includes('mp.weixin')) return 'wechat';
  if (u.includes('youtube.com') || u.includes('youtu.be') || u.includes('xiaoyuzhoufm.com')) return 'podcast';
  return 'web';
}

export function isUrl(text) {
  const t = text.trim();
  if (/\s/.test(t)) return false;
  return /^https?:\/\/\S+$/i.test(t);
}
