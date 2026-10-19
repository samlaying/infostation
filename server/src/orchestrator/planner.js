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
  // ===== v2.3：TODO 派工技能 =====
  gh_search: {
    runtime: 'local', // gh 登录态在用户 Mac 上
    label: '🔎 GitHub 搜索',
    caps: ['gh'],
  },
  agent_task: {
    runtime: 'local', // 由 AI Agent 会话（CLI jobs claim --caps agent）认领执行
    label: '🤖 Agent 委派',
    caps: ['agent'],
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
  // uiSkills.includes('ai_image')：生图技能暂无本地生成器实现——不进计划（QuickInput 的提示已说明由本地 Agent 处理）

  return plan.slice(0, 3);
}

/**
 * v2.3：TODO → 技能计划映射（确定性规则）。
 * assigned_agent 决定执行方式；needs_confirm 由承接人类型定死（local/content 卡确认门，
 * search 只读自动跑），与 LLM 输出无关。
 * @param {object} todo 含 assigned_agent/title/description/acceptance 的 TODO 行
 * @param {object} item 母卡片（source_url/title/line）
 * @param {object} [opts]
 * @param {boolean} [opts.skipConfirm] 用户已显式点按钮触发的任务，无需二次确认
 * @param {object} [opts.extraParams] 附加到每步 params 的字段（如 asset_request/asset_kind）
 * @returns {{skill, params, runtime, needs_confirm?, reason}[]} 单 TODO 的执行计划
 */
export function planTodoJob(todo, item, opts = {}) {
  const agent = todo.assigned_agent;
  const text = `${todo.title} ${todo.description || ''}`;
  const url = item.source_url || '';
  const confirm = !opts.skipConfirm && agent !== 'search_agent'; // local/content 均需用户批准
  const steps = [];

  if (agent === 'search_agent') {
    steps.push({
      skill: 'tavily_search',
      runtime: 'server',
      params: { query: `${todo.title}——${item.title}`.slice(0, 200) },
      reason: `联网调研：${todo.title}`,
    });
    const repo = url.match(GH_RE) || text.match(GH_RE);
    if (repo) {
      steps.push({
        skill: 'gh_search',
        runtime: 'local',
        params: { query: `${repo[1]} ${repo[2]}`, repo: `${repo[1]}/${repo[2]}` },
        reason: 'GitHub 检索该仓库生态的相关项目',
      });
    } else if (/github|开源|仓库/i.test(text)) {
      steps.push({
        skill: 'gh_search',
        runtime: 'local',
        params: { query: todo.title.slice(0, 60) },
        reason: 'GitHub 搜索相关开源实现',
      });
    }
  } else if (agent === 'local_agent') {
    if (/截图|screenshot|首屏/i.test(text) && url) {
      steps.push({
        skill: 'browser_screenshot',
        runtime: 'local',
        needs_confirm: confirm,
        params: { url, full: /整页|全文|长图/.test(text) },
        reason: `真实浏览器截图：${todo.title}`,
      });
    } else if (GH_RE.test(url) || /clone|克隆|仓库/.test(text)) {
      steps.push({
        skill: 'gh_inspect',
        runtime: 'local',
        needs_confirm: confirm,
        params: url.match(GH_RE) ? { repo: `${url.match(GH_RE)[1]}/${url.match(GH_RE)[2]}`, url } : { repo: null, query: todo.title.slice(0, 60), url },
        reason: `仓库检查 + Clone：${todo.title}`,
      });
    } else {
      // 泛化委派：由 AI Agent 会话带着指令执行（注册/试用/演示/ego-lite 能力都走这里）
      steps.push({
        skill: 'agent_task',
        runtime: 'local',
        needs_confirm: confirm,
        params: {
          todo_id: todo.id,
          title: todo.title,
          description: todo.description || '',
          acceptance: todo.acceptance || '',
          item_title: item.title,
          item_summary: item.summary || '',
          line: item.line,
          source_url: url || '',
        },
        reason: `本地 Agent 委派：${todo.title}`,
      });
    }
  } else {
    // content_agent（及兜底）：内容生产委派（建选题/收集素材/整理文案），AI Agent 会话执行
    steps.push({
      skill: 'agent_task',
      runtime: 'local',
      needs_confirm: confirm,
      params: {
        todo_id: todo.id,
        title: todo.title,
        description: todo.description || '',
        acceptance: todo.acceptance || '',
        item_title: item.title,
        item_summary: item.summary || '',
        line: item.line,
        source_url: url || '',
      },
      reason: `内容 Agent 委派：${todo.title}`,
    });
  }
  return steps;
}

/**
 * v2.4：配图任务计划——「🖼 挂载配图」不再是让人贴 URL，
 * 而是派给 Agent：有源链接先让本地 worker 截原页面，再委派 AI Agent 生成/收集配图。
 * 该计划由用户点按钮直接触发，故不带 needs_confirm。
 * @param {object} item 母卡片
 * @param {'ai_image'|'screenshot'} kind 要的产物类型
 */
export function planAssetRequest(item, kind = 'ai_image') {
  const url = item.source_url || '';
  const brief = `为选题《${item.title}》准备配图。选题摘要：${(item.summary || '').slice(0, 200)}`;
  const taskStep = (assetType) => ({
    skill: 'agent_task',
    runtime: 'local',
    params: {
      asset_request: assetType,
      asset_type: assetType,
      title: `为《${item.title}》制作配图`,
      description: `${brief}\n要求：与主题一致、无水印、适合社媒首图（3:2 或 1:1）。`,
      acceptance: '1-3 张配图已上传为卡片资产（jobs complete --asset）',
      item_title: item.title,
      item_summary: item.summary || '',
      line: item.line,
      source_url: url,
    },
    reason: assetType === 'ai_image' ? 'Agent 生成/收集配图并上传' : 'Agent 截取/整理配图并上传',
  });

  if (kind === 'screenshot') {
    if (url) {
      return [{
        skill: 'browser_screenshot',
        runtime: 'local',
        params: { url, full: false, asset_request: 'screenshot', asset_type: 'screenshot' },
        reason: '截取原页面作为配图',
      }];
    }
    return [taskStep('screenshot')];
  }

  const steps = [];
  if (url) {
    steps.push({
      skill: 'browser_screenshot',
      runtime: 'local',
      params: { url, full: false },
      reason: '先截取原页面（配图参考）',
    });
  }
  steps.push(taskStep('ai_image'));
  return steps;
}
