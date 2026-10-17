<script setup>
import { computed } from 'vue';

// 纯 SVG 平滑曲线图（Catmull-Rom 样条 + 渐变面积填充 + 发光数据节点），无第三方依赖
const props = defineProps({
  series: { type: Array, required: true }, // [{date, inputs, todos_done}]
  height: { type: Number, default: 160 },
});

const W = 600;
const H = 160;
const PAD = 8;

const maxVal = computed(() => Math.max(1, ...props.series.map((s) => Math.max(s.inputs, s.todos_done))));

function xy(key) {
  const n = props.series.length;
  return props.series.map((s, i) => {
    const x = PAD + (i / Math.max(n - 1, 1)) * (W - PAD * 2);
    const y = H - PAD - (s[key] / maxVal.value) * (H - PAD * 2);
    return [x, y];
  });
}

/** Catmull-Rom → 三次贝塞尔，得到平滑样条路径 */
function spline(key) {
  const P = xy(key);
  const n = P.length;
  if (!n) return '';
  if (n < 3) return 'M ' + P.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' L ');
  let d = `M ${P[0][0].toFixed(1)},${P[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = P[i - 1] || P[i];
    const p1 = P[i];
    const p2 = P[i + 1];
    const p3 = P[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

const lineInputs = computed(() => spline('inputs'));
const lineDone = computed(() => spline('todos_done'));

const areaInputs = computed(() => {
  const d = lineInputs.value;
  if (!d) return '';
  return `${d} L ${W - PAD},${H - PAD} L ${PAD},${H - PAD} Z`;
});

const dots = computed(() => {
  // 节点密集时只在末位放发光点，避免花
  const P = xy('inputs');
  if (!P.length) return [];
  return P.length <= 10 ? P : [P[P.length - 1]];
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
          <stop offset="0" stop-color="rgba(59,130,246,0.32)" />
          <stop offset="1" stop-color="rgba(59,130,246,0)" />
        </linearGradient>
        <linearGradient id="trend-line-2" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#10b981" />
          <stop offset="1" stop-color="#06b6d4" />
        </linearGradient>
        <filter id="trend-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <!-- 渐变面积填充（顶部 32% 透明度 → 底部 0） -->
      <path :d="areaInputs" fill="url(#trend-area)" />
      <path :d="lineDone" fill="none" stroke="url(#trend-line-2)" stroke-width="1.5" stroke-dasharray="4 3" />
      <path :d="lineInputs" fill="none" stroke="url(#trend-line)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />

      <!-- 发光数据节点 -->
      <circle
        v-for="(p, i) in dots"
        :key="i"
        :cx="p[0].toFixed(1)"
        :cy="p[1].toFixed(1)"
        r="3"
        fill="#8b5cf6"
        stroke="#f8fafc"
        stroke-width="1.2"
        filter="url(#trend-glow)"
      />
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
