<script setup>
// ===== 滑动式分段控制器（Segmented Control）=====
// 选中态是带微投影的实心白块，在半透明槽内平滑滑动（重设计规格 · 二级 Tab 承载件）
import { computed } from 'vue';

const props = defineProps({
  tabs: { type: Array, required: true }, // [{ key, label, icon?, count? }]
  modelValue: { type: [String, Number], required: true },
});
const emit = defineEmits(['update:modelValue']);

const activeIndex = computed(() =>
  Math.max(0, props.tabs.findIndex((t) => t.key === props.modelValue))
);
</script>

<template>
  <div class="seg" role="tablist">
    <div
      class="seg__thumb"
      :style="{ '--n': tabs.length, transform: `translateX(${activeIndex * 100}%)` }"
      aria-hidden="true"
    />
    <button
      v-for="t in tabs"
      :key="t.key"
      type="button"
      role="tab"
      class="seg__item"
      :class="{ 'is-active': t.key === modelValue }"
      :aria-selected="t.key === modelValue"
      @click="emit('update:modelValue', t.key)"
    >
      <span v-if="t.icon" class="seg__icon">{{ t.icon }}</span>
      <span>{{ t.label }}</span>
      <span v-if="t.count != null" class="seg__count">{{ t.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.seg {
  position: relative;
  display: inline-flex;
  padding: 4px;
  background: var(--glass-bg-faint);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-full);
  max-width: 100%;
}

.seg__thumb {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 4px;
  width: calc((100% - 8px) / var(--n));
  background: var(--bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-full);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.1), inset 0 1px 0 var(--glass-highlight);
  transition: transform 320ms cubic-bezier(0.3, 1.2, 0.4, 1);
  pointer-events: none;
}

.seg__item {
  position: relative;
  z-index: 1;
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: 8px 16px;
  font: var(--font-secondary);
  color: var(--text-secondary);
  border-radius: var(--radius-full);
  white-space: nowrap;
  transition: color var(--transition-fast);
  cursor: pointer;
}
.seg__item:hover { color: var(--text-primary); }
.seg__item.is-active { color: var(--text-primary); font-weight: 600; }

.seg__icon { font-size: 13px; }

.seg__count {
  padding: 0 7px;
  font: var(--font-micro);
  color: var(--text-secondary);
  background: rgba(15, 23, 42, 0.06);
  border-radius: var(--radius-full);
}
.seg__item.is-active .seg__count {
  color: var(--accent-blue);
  background: rgba(37, 99, 235, 0.1);
}
</style>
