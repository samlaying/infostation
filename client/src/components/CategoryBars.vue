<script setup>
import { computed } from 'vue';
import { CATEGORY_MAP, PLATFORM_MAP } from '../constants';

// 渐变进度条分布图（分类 / 平台通用）
const props = defineProps({
  data: { type: Array, required: true }, // [{ category|platform, count, percent? }]
  mode: { type: String, default: 'category' }, // category | platform
  max: { type: Number, default: 5 },
});

const GRADIENTS = ['var(--gradient-1)', 'var(--gradient-2)', 'var(--gradient-3)', 'var(--gradient-success)', 'var(--gradient-warning)'];

const rows = computed(() => {
  const maxCount = Math.max(1, ...props.data.map((d) => d.count));
  return props.data
    .filter((d) => d.count > 0)
    .map((d, i) => {
      const meta = props.mode === 'category' ? CATEGORY_MAP[d.category] : null;
      return {
        key: d.category || d.platform,
        label: meta ? `${meta.icon} ${meta.label}` : (PLATFORM_MAP[d.platform] || d.platform),
        count: d.count,
        percent: d.percent ?? Math.round((d.count / maxCount) * 100),
        share: d.percent,
        color: meta ? meta.color : GRADIENTS[i % GRADIENTS.length],
      };
    });
});
</script>

<template>
  <div class="cat-bars">
    <div v-for="r in rows" :key="r.key" class="cat-bars__row">
      <div class="cat-bars__label">
        <span class="cat-bars__dot" :style="{ background: r.color }" />
        <span class="cat-bars__name">{{ r.label }}</span>
        <span class="cat-bars__count">{{ r.count }}</span>
      </div>
      <div class="progress-track cat-bars__track">
        <div
          class="progress-fill cat-bars__fill"
          :style="{ width: `${r.percent}%`, background: `linear-gradient(90deg, ${r.color}, color-mix(in srgb, ${r.color} 40%, #8b5cf6))` }"
        />
      </div>
      <span v-if="r.share !== undefined" class="cat-bars__share">{{ r.share }}%</span>
    </div>
    <div v-if="!rows.length" class="cat-bars__empty timestamp">暂无数据</div>
  </div>
</template>

<style scoped>
.cat-bars {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.cat-bars__row {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.cat-bars__label {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font: var(--font-secondary);
  color: var(--text-primary);
}
.cat-bars__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.cat-bars__count { margin-left: auto; font: var(--font-caption); color: var(--text-secondary); }
.cat-bars__share { font: var(--font-micro); color: var(--text-muted); text-align: right; }

.cat-bars__empty { text-align: center; padding: var(--space-7); }
</style>
