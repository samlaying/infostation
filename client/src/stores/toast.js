// ===== 全局 Toast =====
import { reactive } from 'vue';

let uid = 0;

export const toastState = reactive({
  toasts: [],
});

export function toast(message, type = 'info', duration = 3200) {
  const id = ++uid;
  toastState.toasts.push({ id, message, type });
  if (toastState.toasts.length > 4) toastState.toasts.shift();
  setTimeout(() => {
    const i = toastState.toasts.findIndex((t) => t.id === id);
    if (i !== -1) toastState.toasts.splice(i, 1);
  }, duration);
}

export const toastSuccess = (m) => toast(m, 'success');
export const toastError = (m) => toast(m, 'error');
export const toastInfo = (m) => toast(m, 'info');
