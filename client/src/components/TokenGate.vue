<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { getToken, setToken } from '../api';

const visible = ref(false);
const token = ref('');
const error = ref('');

function show() {
  token.value = getToken();
  error.value = '';
  visible.value = true;
}

function onKeydown(e) {
  if (e.key === 'Escape') visible.value = false;
}

function submit() {
  const t = token.value.trim();
  if (!t) {
    error.value = '请输入 API Token';
    return;
  }
  setToken(t);
  visible.value = false;
  location.reload();
}

function clearToken() {
  setToken('');
  location.reload();
}

onMounted(() => {
  window.addEventListener('infostation:auth-required', show);
  window.addEventListener('keydown', onKeydown);
});
onUnmounted(() => {
  window.removeEventListener('infostation:auth-required', show);
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" @keydown="onKeydown">
      <div class="gate modal-box" @click.stop>
        <div class="gate__icon">🔐</div>
        <h2 class="gate__title">需要 API Token</h2>
        <p class="gate__desc">
          此 InfoStation 实例已启用鉴权。请输入服务端 <code>.env</code> 中配置的
          <code>API_TOKEN</code>（Token 仅保存在本浏览器，请求时通过 X-API-Key 携带）。
        </p>
        <input
          v-model="token"
          class="glass-input gate__input"
          type="password"
          placeholder="粘贴 API Token…"
          autofocus
          @keydown.enter="submit"
        />
        <div v-if="error" class="gate__error">{{ error }}</div>
        <div class="gate__actions">
          <button v-if="getToken()" class="btn btn--glass btn--sm" @click="clearToken">清除已存 Token</button>
          <button class="btn btn--primary" @click="submit">解锁</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.gate {
  max-width: 440px;
  padding: var(--space-13);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.gate__icon { font-size: 34px; text-align: center; }
.gate__title { text-align: center; }

.gate__desc {
  font: var(--font-secondary);
  color: var(--text-secondary);
  line-height: 1.8;
  text-align: center;
}
.gate__desc code {
  padding: 1px 6px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  font-size: 12px;
  color: var(--accent-cyan);
}

.gate__input { text-align: center; letter-spacing: 1px; }

.gate__error {
  font: var(--font-caption);
  color: var(--accent-red);
  text-align: center;
}

.gate__actions {
  display: flex;
  justify-content: center;
  gap: var(--space-4);
}
</style>
