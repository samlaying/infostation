// ===== Tavily 深度检索（服务器端可执行的轻技能）=====
// 需要 server/.env 配 TAVILY_API_KEY；未配置时技能自动 skip（planner 会在 logs 标注原因）。

const API_URL = 'https://api.tavily.com/search';

export function tavilyConfigured() {
  return Boolean(process.env.TAVILY_API_KEY);
}

/**
 * @param {string} query 检索词
 * @returns {Promise<{summary: string, sources: {title: string, url: string}[]}>}
 */
export async function tavilySearch(query) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query: String(query).slice(0, 400),
      search_depth: 'advanced',
      include_answer: true,
      max_results: 5,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const data = await res.json();
  return {
    summary: data.answer || '',
    sources: (data.results || []).slice(0, 5).map((r) => ({ title: (r.title || '').slice(0, 80), url: r.url })),
  };
}
