// ===== API 封装：统一前缀 /api/v1，错误抛出带 message =====

const BASE = '/api/v1';
const TOKEN_KEY = 'infostation_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** 401 时通知全局显示 Token 门禁（App.vue 监听） */
export function notifyAuthRequired() {
  window.dispatchEvent(new CustomEvent('infostation:auth-required'));
}

export class ApiError extends Error {
  constructor(message, { status, data } = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request(path, { method = 'GET', body, params } = {}) {
  let url = `${BASE}${path}`;
  if (params) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString();
    if (qs) url += `?${qs}`;
  }

  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers['X-API-Key'] = token;

  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }

  if (res.status === 401) {
    notifyAuthRequired();
    throw new ApiError('需要 API Token', { status: 401, data });
  }

  if (!res.ok) {
    throw new ApiError(data?.error || `请求失败（HTTP ${res.status}）`, { status: res.status, data });
  }
  return data;
}

export const api = {
  get: (path, params) => request(path, { params }),
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  delete: (path) => request(path, { method: 'DELETE' }),
};

// ===== 业务接口 =====
export const processInput = (payload) => api.post('/process', payload);
export const fetchItems = (params) => api.get('/items', params);
export const fetchItem = (id) => api.get(`/items/${id}`);
export const patchItem = (id, body) => api.patch(`/items/${id}`, body);
export const deleteItem = (id) => api.delete(`/items/${id}`);

export const fetchTodos = (params) => api.get('/todos', params);
export const createTodo = (body) => api.post('/todos', body);
export const patchTodo = (id, body) => api.patch(`/todos/${id}`, body);
export const deleteTodo = (id) => api.delete(`/todos/${id}`);

// ===== v2.0：主题 / 资产 / 帖子 =====
export const fetchTopics = (params) => api.get('/topics', params);
export const createTopic = (body) => api.post('/topics', body);
export const patchTopic = (id, body) => api.patch(`/topics/${id}`, body);
export const deleteTopic = (id) => api.delete(`/topics/${id}`);

export const fetchAssets = (params) => api.get('/assets', params);
export const createAsset = (body) => api.post('/assets', body);
// v2.4：派 Agent 去配图（本地 worker 截图 + AI Agent 生成/收集，完成后自动入资产区）
export const requestAssets = (itemId, kind = 'ai_image') => api.post('/assets/request', { item_id: itemId, kind });
export const patchAsset = (id, body) => api.patch(`/assets/${id}`, body);
export const deleteAsset = (id) => api.delete(`/assets/${id}`);

export const fetchPosts = (params) => api.get('/posts', params);
export const createPost = (body) => api.post('/posts', body);
export const patchPost = (id, body) => api.patch(`/posts/${id}`, body);
export const deletePost = (id) => api.delete(`/posts/${id}`);

export const fetchStats = () => api.get('/stats');

// ===== v2.2：Agent 预处理任务 =====
export const fetchJobs = (params) => api.get('/agent-jobs', params);
export const reprocessItem = (itemId) => api.post(`/agent-jobs/reprocess/${itemId}`, {});
// v2.3 确认门：批准 / 跳过 awaiting_user 的任务
export const approveJob = (id, action) => api.post(`/agent-jobs/${id}/approve`, { action });
export const fetchWeeklyReport = (refresh) => api.get('/weekly-report', refresh ? { refresh: 1 } : undefined);
export const fetchWeeklyReports = () => api.get('/weekly-reports');
export const fetchSettings = () => api.get('/settings');
export const updateSettings = (body) => api.put('/settings', body);

export const extractUrl = (url) => api.post('/extract', { url });
export const exportJson = () => api.get('/export');
export const importJson = (payload) => api.post('/import', payload);
export const clearAllData = () => api.delete('/data');
