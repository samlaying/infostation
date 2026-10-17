// ===== SSE 实时订阅：落库广播 → 打开中的面板自动刷新 =====
// 服务端 GET /api/v1/events 推 change 事件（见 server/src/routes/events.js）。
// 单例 EventSource：任何视图首次订阅时建立连接，断线由浏览器自动重连；
// 重连成功或事件序号断档时升级为 resource:'all' 全量刷新，兜住丢失的事件。

import { onUnmounted } from 'vue';
import { getToken, notifyAuthRequired } from './index.js';

let source = null;
let lastSeq = 0; // 0 = 尚未收到任何事件
let everConnected = false;
const handlers = new Set();

function dispatch(event) {
  for (const fn of handlers) {
    try {
      fn(event);
    } catch {
      // 单个视图回调异常不影响其他订阅者
    }
  }
}

function open() {
  const token = getToken();
  const url = `/api/v1/events${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  source = new EventSource(url);

  source.addEventListener('change', (e) => {
    let evt;
    try {
      evt = JSON.parse(e.data);
    } catch {
      return;
    }
    // 序号不连续 = 丢过事件（或服务端重启序号归零）→ 按全量刷新处理
    if (lastSeq && evt.seq !== lastSeq + 1) evt = { ...evt, resource: 'all' };
    lastSeq = evt.seq;
    dispatch(evt);
  });

  source.onopen = () => {
    // 断开后又连上：断线期间的事件已丢，统一全量刷新
    if (everConnected) dispatch({ resource: 'all', action: 'reconnect', ts: Date.now() });
    everConnected = true;
  };

  source.onerror = () => {
    // 网络断开浏览器会自动重连；HTTP 401/403 等错误状态不会 → 手动延迟重试
    if (source && source.readyState === EventSource.CLOSED) {
      source.close();
      source = null;
      if (getToken()) setTimeout(open, 5000);
      else notifyAuthRequired();
    }
  };
}

/** 订阅实时变更事件，返回取消订阅函数 */
export function subscribeLive(handler) {
  handlers.add(handler);
  if (!source) open();
  return () => handlers.delete(handler);
}

/**
 * 视图级组合式函数：命中所关心的资源变更时（防抖 300ms）重拉当前视图。
 * @param reload 刷新回调（重放视图自己的 load）
 * @param resources 关心的资源：items|todos|topics|assets|posts（'all' 事件总是命中）
 */
export function useLiveReload(reload, resources) {
  let timer = null;
  const off = subscribeLive((evt) => {
    if (evt.resource !== 'all' && !resources.includes(evt.resource)) return;
    clearTimeout(timer);
    // 一次落库常连发多条事件（如 process add → items+todos），合并成一次刷新
    timer = setTimeout(reload, 300);
  });
  onUnmounted(() => {
    clearTimeout(timer);
    off();
  });
}
