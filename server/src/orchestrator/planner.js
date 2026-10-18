// ===== 意图路由 / 技能规划器（Planner）=====
// v1 用确定性规则（URL 形态 + line + UI 技能开关）生成技能执行计划，不依赖 LLM——
// 计划错了可以重跑（job 幂等重试），规则先行让整条链路可预测、可调试。
// 计划里的每一步声明 runtime：'server'（VPS 可直接执行）| 'local'（需要用户 Mac 上的
// ego 浏览器 / gh 登录态，由 CLI worker 认领）。

export const SKILL_REGISTRY = {
  tavily_search: {
    runtime: 'server',
    label: '🔍 联网调研',
    caps: [], // server 技能无需本地能力
  },
  browser_screenshot: {
    runtime: 'local',
    label: '📸 网页截图',
    caps: ['browser'], // CLI worker 上报的能力
  },
  gh_inspect: {
    runtime: 'local',
    label: '💻 仓库检查+Clone',
    caps: ['gh'],
  },
};

const GH_RE = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)/i;
const SOCIAL_RE = /^https?:\/\/(www\.)?(xiaohongshu\.com|x\.com|twitter\.com|mp\.weixin\.qq\.com)\//i;

/**
 * 生成预处理计划。
 * @param item 已落库的卡片（含 source_url / line / item_type / title / raw_input.skills）
 * @returns {{skill, params, runtime, reason}[]} 计划（最多 3 步，按执行顺序）
 */
export function planFor(item) {
  const plan = [];
  const url = item.source_url || '';
  const uiSkills = item.raw_input?.skills || [];
  const gh = url.match(GH_RE);

  if (gh) {
    plan.push({
      skill: 'gh_inspect',
      runtime: 'local',
      params: { repo: `${gh[1]}/${gh[2]}`, url },
      reason: 'GitHub 链接：拉取仓库元信息 + Clone 到本地试验目录，提取安装命令',
    });
    plan.push({
      skill: 'browser_screenshot',
      runtime: 'local',
      params: { url, full: false },
      reason: '用真实浏览器截取仓库首页（README 可见区），存入卡片资产',
    });
  } else if (SOCIAL_RE.test(url)) {
    plan.push({
      skill: 'browser_screenshot',
      runtime: 'local',
      params: { url, full: false },
      reason: '社媒链接：带登录态截图原帖（配图与评论区可见），存入卡片资产',
    });
  } else if (url) {
    plan.push({
      skill: 'browser_screenshot',
      runtime: 'local',
      params: { url, full: false },
      reason: '外部链接：截取首屏留档，点开卡片即可回看现场',
    });
  }

  // 纯想法/选题（无 URL）：先做背景调研，为「下一步」备好弹药
  if (!url) {
    plan.push({
      skill: 'tavily_search',
      runtime: 'server',
      params: { query: `${item.title} ${item.summary || ''}`.slice(0, 200) },
      reason: '新概念/选题缺上下文：先拉一份前置调研简报（教程/价格/最新讨论）',
    });
  }

  // UI 点亮的技能开关强制生效（用户显式要求截图）
  if (uiSkills.includes('screenshot') && url && !plan.some((p) => p.skill === 'browser_screenshot')) {
    plan.push({
      skill: 'browser_screenshot',
      runtime: 'local',
      params: { url, full: true },
      reason: '用户点亮 📸 自动截图：整页截图存档',
    });
  }
  // ai_image 技能暂无本地生成器实现——不进计划（QuickInput 的提示已说明由本地 Agent 处理）

  return plan.slice(0, 3);
}
