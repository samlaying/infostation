<script setup>
import { ref, computed, onMounted } from 'vue';
import { useStatsStore } from '../stores/stats';
import { CATEGORY_MAP } from '../constants';
import StatCard from '../components/StatCard.vue';
import TrendChart from '../components/TrendChart.vue';
import CategoryBars from '../components/CategoryBars.vue';
import TagCloud from '../components/TagCloud.vue';
import EmptyState from '../components/EmptyState.vue';

const statsStore = useStatsStore();
const trendRange = ref(7); // 7 | 30

onMounted(() => statsStore.load());

const series = computed(() =>
  trendRange.value === 7 ? statsStore.data?.trend_7d : statsStore.data?.trend_30d
);
</script>

<template>
  <div v-if="statsStore.data" class="analytics">
    <!-- 总览统计 -->
    <div class="analytics__stats">
      <StatCard
        v-for="(s, i) in [
          { label: '总信息量', value: statsStore.data.items.total, icon: '📊', deltaText: `本月 +${statsStore.data.items.month_new}`, deltaTone: 'up', gradient: 'var(--gradient-1)' },
          { label: 'TODO 总数', value: statsStore.data.todos.total, icon: '📋', deltaText: `待执行 ${statsStore.data.todos.pending}`, deltaTone: 'flat', gradient: 'var(--gradient-2)' },
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
      <!-- 分类分布 -->
      <section class="glass-panel analytics__panel">
        <div class="panel-header"><h2>📊 分类分布</h2></div>
        <CategoryBars :data="statsStore.data.category_distribution" mode="category" />
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

      <!-- 目标进度 -->
      <section class="glass-panel analytics__panel">
        <div class="panel-header"><h2>🎯 目标进度</h2></div>
        <div class="analytics__goals">
          <div v-for="g in statsStore.data.goal_progress" :key="g.category" class="analytics__goal">
            <div class="analytics__goal-label">
              <span :style="{ color: CATEGORY_MAP[g.category].color }">
                {{ CATEGORY_MAP[g.category].icon }} {{ CATEGORY_MAP[g.category].label }}
              </span>
              <span class="timestamp">{{ g.done }}/{{ g.total }} · {{ Math.round(g.rate * 100) }}%</span>
            </div>
            <div class="progress-track">
              <div
                class="progress-fill"
                :style="{
                  width: `${Math.round(g.rate * 100)}%`,
                  background: CATEGORY_MAP[g.category].color,
                }"
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
