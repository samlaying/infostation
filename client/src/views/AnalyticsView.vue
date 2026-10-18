<script setup>
import { ref, computed, onMounted } from 'vue';
import { useStatsStore } from '../stores/stats';
import { useTopicsStore } from '../stores/topics';
import StatCard from '../components/StatCard.vue';
import TrendChart from '../components/TrendChart.vue';
import CategoryBars from '../components/CategoryBars.vue';
import TagCloud from '../components/TagCloud.vue';
import EmptyState from '../components/EmptyState.vue';
import { LINE_MAP } from '../constants';
import { useLiveReload } from '../api/live';

const statsStore = useStatsStore();
const topicsStore = useTopicsStore();
const trendRange = ref(7); // 7 | 30

// 双轨拆分（v2.0 起后端 stats 直接返回分线口径）：TODO 总数 = ⚡行动 + 🔨内容工序
const todoSplit = computed(() => {
  const t = statsStore.data?.todos;
  return t && Number.isFinite(t.trial_count)
    ? {
        a: { label: '⚡ 行动', value: t.trial_count, color: 'var(--line-trial)' },
        b: { label: '🔨 工序', value: t.media_count, color: 'var(--line-media)' },
      }
    : null;
});

onMounted(() => { statsStore.load(); topicsStore.load(); });

// SSE：数据变更后统计自动重算
useLiveReload(() => { statsStore.load(); topicsStore.refresh(); }, ['items', 'todos', 'topics']);

const series = computed(() =>
  trendRange.value === 7 ? statsStore.data?.trend_7d : statsStore.data?.trend_30d
);

// v2.1 主题健康度：卡片量 + 距最近活跃天数（>7 天标荒废）
function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z')).getTime()) / 86400000);
}
const topicHealth = computed(() =>
  topicsStore.active.map((t) => {
    const days = daysSince(t.last_active_at);
    return { ...t, days, idle: days == null || days > 7 };
  })
);
const topicMax = computed(() => Math.max(1, ...topicHealth.value.map((t) => t.item_count)));

// v2.1 双线分布（取代旧 category 目标进度）：代试 vs 内容的卡片量
const lineDist = computed(() => {
  const d = statsStore.data?.item_line_distribution || {};
  return [
    { ...LINE_MAP.trial, key: 'trial', count: d.trial || 0 },
    { ...LINE_MAP.media, key: 'media', count: d.media || 0 },
  ];
});
</script>

<template>
  <div v-if="statsStore.data" class="analytics">
    <!-- 总览统计 -->
    <div class="analytics__stats">
      <StatCard
        v-for="(s, i) in [
          { label: '总信息量', value: statsStore.data.items.total, icon: '📊', deltaText: `本月 +${statsStore.data.items.month_new}`, deltaTone: 'up', gradient: 'var(--gradient-1)' },
          { label: 'TODO 总数', value: statsStore.data.todos.total, icon: '📋', deltaText: `待执行 ${statsStore.data.todos.pending}`, deltaTone: 'flat', gradient: 'var(--gradient-2)', split: todoSplit },
          { label: 'TODO 完成率', value: `${Math.round(statsStore.data.todos.completion_rate * 100)}%`, icon: '✅', deltaText: `本周完成 ${statsStore.data.todos.week_done} 条`, deltaTone: 'up', gradient: 'var(--gradient-3)' },
          { label: '本周完成率', value: `${Math.round(statsStore.data.todos.week_rate * 100)}%`, icon: '🎯', deltaText: `本周新建 ${statsStore.data.todos.week_created}`, deltaTone: 'flat', gradient: 'var(--gradient-success)' },
        ]"
        :key="s.label"
        v-bind="s"
        :index="i"
      />
    </div>

    <!-- 趋势 -->
    <section class="glass-panel analytics__panel">
      <div class="panel-header">
        <h2>📈 处理趋势</h2>
        <div class="analytics__range">
          <button class="filter-chip" :class="{ 'is-active': trendRange === 7 }" @click="trendRange = 7">近 7 天</button>
          <button class="filter-chip" :class="{ 'is-active': trendRange === 30 }" @click="trendRange = 30">近 30 天</button>
        </div>
      </div>
      <TrendChart :series="series || []" />
    </section>

    <div class="analytics__grid">
      <!-- v2.1：主题健康度（取代旧「分类分布」——主题才是唯一归属轴） -->
      <section class="glass-panel analytics__panel">
        <div class="panel-header"><h2>📁 主题健康度</h2></div>
        <div class="analytics__topics">
          <div v-for="t in topicHealth" :key="t.id" class="analytics__topic" :style="{ '--topic-color': t.color }">
            <div class="analytics__topic-label">
              <span>{{ t.icon }} {{ t.name }}</span>
              <span class="timestamp" :class="{ 'is-idle': t.idle }">
                {{ t.days == null ? '未活跃' : t.days === 0 ? '今天活跃' : `${t.days} 天未更` }}
              </span>
            </div>
            <div class="progress-track">
              <div class="progress-fill" :style="{ width: `${Math.round((t.item_count / topicMax) * 100)}%`, background: t.color }" />
            </div>
            <div class="timestamp">{{ t.item_count }} 卡 · {{ t.todo_count }} 任务</div>
          </div>
          <div v-if="!topicHealth.length" class="timestamp">还没有主题，去信息库左侧新建</div>
        </div>
      </section>

      <!-- 来源分布 -->
      <section class="glass-panel analytics__panel">
        <div class="panel-header"><h2>⏰ 信息来源分布</h2></div>
        <CategoryBars :data="statsStore.data.platform_distribution" mode="platform" />
      </section>
    </div>

    <div class="analytics__grid analytics__grid--2">
      <!-- 活跃标签 -->
      <section class="glass-panel analytics__panel">
        <div class="panel-header"><h2>🔥 活跃标签 TOP 10</h2></div>
        <TagCloud :tags="statsStore.data.top_tags" />
      </section>

      <!-- v2.1：双线分布（取代旧 category 目标进度） -->
      <section class="glass-panel analytics__panel">
        <div class="panel-header"><h2>🎯 双线流水</h2></div>
        <div class="analytics__goals">
          <div v-for="l in lineDist" :key="l.key" class="analytics__goal">
            <div class="analytics__goal-label">
              <span>{{ l.icon }} {{ l.short }}</span>
              <span class="timestamp">{{ l.count }} 张卡</span>
            </div>
            <div class="progress-track">
              <div
                class="progress-fill"
                :style="{ width: `${Math.round((l.count / Math.max(1, ...lineDist.map((x) => x.count))) * 100)}%`, background: l.color }"
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>

  <EmptyState v-else-if="!statsStore.loading" icon="📊" title="暂无数据" desc="处理信息后这里会出现可视化看板" />
</template>

<style scoped>
.analytics { display: flex; flex-direction: column; gap: var(--space-9); }

/* v2.1 主题健康度 */
.analytics__topics { display: flex; flex-direction: column; gap: var(--space-6); }
.analytics__topic { display: flex; flex-direction: column; gap: var(--space-3); }
.analytics__topic-label {
  display: flex; align-items: center; justify-content: space-between;
  font: var(--font-secondary); color: var(--text-primary);
}
.analytics__topic-label .is-idle { color: var(--accent-orange); }

.analytics__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-7);
}

.analytics__panel { padding: var(--space-11); }
.analytics__range { display: flex; gap: var(--space-3); }

.analytics__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-9);
}

.analytics__goals { display: flex; flex-direction: column; gap: var(--space-7); }
.analytics__goal-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font: var(--font-secondary);
  margin-bottom: var(--space-3);
}

@media (max-width: 1024px) {
  .analytics__grid { grid-template-columns: 1fr; }
}
</style>
