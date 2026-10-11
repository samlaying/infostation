<script setup>
// 统计卡片（guide.md 10.3：渐变顶线 + 标签 + 大数字 + 趋势徽章）
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], required: true },
  deltaText: { type: String, default: '' },   // 如 "+5 今日新增"
  deltaTone: { type: String, default: 'up' }, // up | down | flat
  gradient: { type: String, default: 'var(--gradient-1)' },
  icon: { type: String, default: '' },
});
</script>

<template>
  <div class="stat-card glass-card fade-in" :style="{ '--delay': `${$attrs.index * 80 || 0}ms` }">
    <div class="stat-card__topline" :style="{ background: gradient }" />
    <div class="stat-card__body">
      <div class="stat-card__label">
        <span v-if="icon" class="stat-card__icon">{{ icon }}</span>
        {{ label }}
      </div>
      <div class="stat-card__value">{{ value }}</div>
      <div v-if="deltaText" class="stat-card__delta" :class="`is-${deltaTone}`">
        {{ deltaText }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.stat-card {
  overflow: hidden;
  animation-name: fadeInFloat;
}

.stat-card__topline {
  height: 3px;
  border-radius: 3px 3px 0 0;
  margin: -1px -1px 0;
}

.stat-card__body { padding: var(--space-10); }

.stat-card__label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font: var(--font-caption);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.stat-card__value {
  font: 700 32px/1.2 var(--font-family);
  letter-spacing: -1px;
  margin-top: var(--space-3);
  color: var(--text-primary);
}

.stat-card__delta {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-top: var(--space-3);
  padding: 2px 8px;
  font: var(--font-micro);
  border-radius: var(--radius-full);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
}
.stat-card__delta.is-up { color: var(--accent-green); }
.stat-card__delta.is-down { color: var(--accent-red); }
</style>
