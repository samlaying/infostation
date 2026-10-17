// ===== 领域枚举与展示映射（与后端 server/src/constants.js 一致）=====

// 产品线：正交于 category 的维度
// trial = TODO 线（值得试的东西 → 行动）；media = 自媒体线（话题素材 → 内容工序）
export const LINE_MAP = {
  trial: { label: 'TODO 线', short: '代试', icon: '🚀', color: 'var(--accent-blue)', desc: '值得试的东西 → 结论 + 行动项' },
  media: { label: '自媒体线', short: '内容生产', icon: '✍️', color: 'var(--accent-purple)', desc: '话题/素材 → 选题库 + 内容工序' },
};

// 自媒体线卡片角色（用标签表达，与后端 MEDIA_ROLE_TAGS 及 skill 约定一致）
export const MEDIA_ROLE_MAP = {
  素材: { icon: '📥', label: '素材' },
  选题: { icon: '💡', label: '选题' },
  发布包: { icon: '📦', label: '发布包' },
  已发布: { icon: '🚀', label: '已发布' },
};

export const CATEGORY_MAP = {
  career: { label: '职场提升', icon: '🚀', color: 'var(--accent-blue)' },
  media: { label: '自媒体', icon: '📱', color: 'var(--accent-purple)' },
  sidehustle: { label: '副业', icon: '💰', color: 'var(--accent-green)' },
  growth: { label: '认知成长', icon: '🧠', color: 'var(--accent-cyan)' },
  tools: { label: '工具推荐', icon: '🔧', color: 'var(--accent-orange)' },
  archive: { label: '存档', icon: '📦', color: 'var(--text-secondary)' },
};

export const CONTENT_TYPE_MAP = {
  tutorial: '教程',
  insight: '观点',
  case: '案例',
  data: '数据',
  tool: '工具',
  template: '模板',
};

export const PRIORITY_MAP = {
  high: { label: '高', color: 'var(--accent-red)' },
  medium: { label: '中', color: 'var(--accent-orange)' },
  low: { label: '低', color: 'var(--accent-green)' },
};

export const PLATFORM_MAP = {
  xhs: '小红书',
  twitter: '推特',
  jike: '即刻',
  wechat: '微信公众号',
  web: '网页',
  podcast: '播客',
  manual: '手动',
  other: '其他',
};

export const TODO_STATUS_MAP = {
  pending: '待执行',
  in_progress: '进行中',
  done: '已完成',
  archived: '已归档',
};

// 目标看板三列（PRD 三大目标领域）
export const GOAL_COLUMNS = [
  { key: 'career', label: '职场提升', icon: '🚀' },
  { key: 'media', label: '自媒体', icon: '📱' },
  { key: 'sidehustle', label: '副业', icon: '💰' },
];

/** 相对时间显示 */
export function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d === 1) return '昨天';
  if (d < 30) return `${d} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

export function fmtDate(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}
