// ===== 领域枚举（与前端 client/src/constants/index.js 保持一致）=====

export const CATEGORIES = ['career', 'media', 'sidehustle', 'growth', 'tools', 'archive'];
export const CONTENT_TYPES = ['tutorial', 'insight', 'case', 'data', 'tool', 'template'];
export const PRIORITIES = ['high', 'medium', 'low'];
export const TODO_STATUSES = ['pending', 'in_progress', 'done', 'archived'];
export const RELATION_TYPES = ['same_topic', 'complementary', 'contradicting'];
export const SOURCE_TYPES = ['url', 'text', 'manual', 'import', 'clipper'];
export const SOURCE_PLATFORMS = ['xhs', 'twitter', 'jike', 'wechat', 'web', 'podcast', 'manual', 'other'];

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
