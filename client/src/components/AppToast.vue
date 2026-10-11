<script setup>
defineProps({
  toasts: { type: Array, default: () => [] },
});

const ICONS = { success: '✓', error: '✕', info: 'ℹ' };
</script>

<template>
  <div class="toast-host">
    <TransitionGroup name="toast-list">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="`toast--${t.type}`">
        <span class="toast__icon">{{ ICONS[t.type] || 'ℹ' }}</span>
        <span class="toast__msg">{{ t.message }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  top: 80px;
  right: var(--space-11);
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.toast__icon { font-size: 12px; opacity: 0.9; }
.toast__msg { word-break: break-all; }

.toast-list-leave-active { transition: all 400ms ease; }
.toast-list-leave-to { opacity: 0; transform: translateX(24px); }
</style>
