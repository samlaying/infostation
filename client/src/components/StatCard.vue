<script setup>
// 统计卡片（guide.md 10.3：渐变顶线 + 标签 + 大数字 + 趋势徽章）
// split：双轨分段数字卡（双色玻璃条 + 图例），用于在全局口径下拆解业务线构成
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], required: true },
  deltaText: { type: String, default: '' },   // 如 "+5 今日新增"
  deltaTone: { type: String, default: 'up' }, // up | down | flat
  gradient: { type: String, default: 'var(--gradient-1)' },
  icon: { type: String, default: '' },
  split: { type: Object, default: null }, // { a: {label,value,color}, b: {label,value,color} }
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

      <!-- 双轨分段条：42 = ⚡行动 26 + 🔨工序 16 -->
      <div v-if="split" class="stat-card__split">
        <div class="stat-card__splitbar">
          <i :style="{ flexGrow: Math.max(split.a.value, 0.001), background: split.a.color }" />
          <i :style="{ flexGrow: Math.max(split.b.value, 0.001), background: split.b.color }" />
        </div>
        <div class="stat-card__splitlegend">
          <span><i :style="{ background: split.a.color }" />{{ split.a.label }} {{ split.a.value }}</span>
          <span><i :style="{ background: split.b.color }" />{{ split.b.label }} {{ split.b.value }}</span>
        </div>
      </div>

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

/* ===== 双轨分段条 ===== */
.stat-card__split { margin-top: var(--space-4); }
.stat-card__splitbar {
  display: flex;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  background: rgba(15, 23, 42, 0.08);
}
.stat-card__splitbar i {
  display: block;
  min-width: 3px;
  transition: flex-grow var(--transition-slow);
}
.stat-card__splitlegend {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  margin-top: var(--space-2);
  font: var(--font-micro);
  color: var(--text-secondary);
}
.stat-card__splitlegend span {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.stat-card__splitlegend i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
</style>
