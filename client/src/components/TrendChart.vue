<script setup>
import { computed } from 'vue';

// 纯 SVG 折线图（渐变描边 + 区域填充），无第三方依赖
const props = defineProps({
  series: { type: Array, required: true }, // [{date, inputs, todos_done}]
  height: { type: Number, default: 160 },
});

const W = 600;
const H = 160;
const PAD = 8;

const maxVal = computed(() => Math.max(1, ...props.series.map((s) => Math.max(s.inputs, s.todos_done))));

function pts(key) {
  const n = props.series.length;
  if (!n) return '';
  return props.series
    .map((s, i) => {
      const x = PAD + (i / Math.max(n - 1, 1)) * (W - PAD * 2);
      const y = H - PAD - (s[key] / maxVal.value) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

const areaInputs = computed(() => {
  const p = pts('inputs');
  if (!p) return '';
  return `M ${PAD},${H - PAD} L ${p.replace(/ /g, ' L ')} L ${W - PAD},${H - PAD} Z`;
});

const labels = computed(() =>
  props.series
    .map((s, i) => ({ text: s.date.slice(5).replace('-', '/'), i }))
    .filter((_, i) => props.series.length <= 8 || i % Math.ceil(props.series.length / 8) === 0)
);
</script>

<template>
  <div class="trend">
    <svg :viewBox="`0 0 ${W} ${H}`" class="trend__svg" preserveAspectRatio="none" role="img">
      <defs>
        <linearGradient id="trend-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#3b82f6" />
          <stop offset="1" stop-color="#8b5cf6" />
        </linearGradient>
        <linearGradient id="trend-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="rgba(59,130,246,0.25)" />
          <stop offset="1" stop-color="rgba(59,130,246,0)" />
        </linearGradient>
        <linearGradient id="trend-line-2" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#10b981" />
          <stop offset="1" stop-color="#06b6d4" />
        </linearGradient>
      </defs>

      <path :d="areaInputs" fill="url(#trend-area)" />
      <polyline :points="pts('todos_done')" fill="none" stroke="url(#trend-line-2)" stroke-width="1.5" stroke-dasharray="4 3" />
      <polyline :points="pts('inputs')" fill="none" stroke="url(#trend-line)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <div class="trend__labels">
      <span v-for="(l, i) in labels" :key="i" class="trend__label">{{ l.text }}</span>
    </div>
    <div class="trend__legend">
      <span class="trend__legend-item"><i class="trend__dot trend__dot--input" />信息输入</span>
      <span class="trend__legend-item"><i class="trend__dot trend__dot--done" />TODO 完成</span>
    </div>
  </div>
</template>

<style scoped>
.trend { display: flex; flex-direction: column; gap: var(--space-3); }
.trend__svg { width: 100%; height: v-bind('props.height + "px"'); }

.trend__labels {
  display: flex;
  justify-content: space-between;
  font: var(--font-micro);
  color: var(--text-muted);
}

.trend__legend { display: flex; gap: var(--space-9); }
.trend__legend-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font: var(--font-micro);
  color: var(--text-secondary);
}
.trend__dot {
  width: 10px;
  height: 3px;
  border-radius: 2px;
  display: inline-block;
}
.trend__dot--input { background: var(--gradient-1); }
.trend__dot--done { background: var(--gradient-success); }
</style>
