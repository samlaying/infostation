// ===== 进程内 SSE 事件总线 =====
// 写路由落库成功后 broadcast()，/events 端点 subscribe() 后推给浏览器，
// 前端 EventSource 收到变更事件即精确刷新对应视图（无需手动刷新页面）。

const clients = new Set();
let seq = 0;

/** 订阅变更事件，返回取消订阅函数 */
export function subscribe(fn) {
  clients.add(fn);
  return () => clients.delete(fn);
}

/**
 * 落库后广播变更。
 * @param resource items|todos|topics|assets|posts|jobs|all（all = 导入/清库等全局变更）
 * @param action  create|update|delete|import|clear|completed
 * @param id      变更对象 id（可空）
 */
export function broadcast(resource, action, id = null) {
  const event = { seq: ++seq, resource, action, id, ts: Date.now() };
  for (const fn of clients) {
    try {
      fn(event);
    } catch {
      // 单个连接回调异常不影响其他订阅者
    }
  }
}
