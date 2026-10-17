<script setup>
import { ref, onMounted } from 'vue';
import { fetchWeeklyReport, fetchWeeklyReports } from '../api';
import { CATEGORY_MAP, PRIORITY_MAP } from '../constants';
import EmptyState from '../components/EmptyState.vue';
import { toastError } from '../stores/toast';
import { useLiveReload } from '../api/live';

const report = ref(null);
const history = ref([]);
const loading = ref(false);

async function load(refresh = false) {
  loading.value = true;
  try {
    const [r, h] = await Promise.all([
      fetchWeeklyReport(refresh),
      fetchWeeklyReports(),
    ]);
    report.value = r;
    history.value = h.reports;
  } catch (e) {
    toastError(e.message);
  } finally {
    loading.value = false;
  }
}

onMounted(() => load());

// SSE：导入/清库等全局变更后重拉周报
useLiveReload(() => load(), []);

async function viewHistory(r) {
  report.value = r;
}

function rangeText(r) {
  return `${r.week_start.slice(5).replace('-', '/')} - ${r.week_end.slice(5).replace('-', '/')}`;
}
</script>

<template>
  <div class="weekly">
    <!-- 左：历史周报时间轴（Week Selector） -->
    <aside v-if="history.length" class="weekly__history">
      <h3 class="weekly__history-title">🗂 历史周报</h3>
      <div class="weekly__timeline">
        <button
          v-for="r in history"
          :key="r.id"
          class="weekly__history-item"
          :class="{ 'is-active': report?.week_start === r.week_start }"
          @click="viewHistory(r)"
        >
          <span class="weekly__timeline-dot" aria-hidden="true" />
          <span class="weekly__history-range">{{ rangeText(r) }}</span>
          <span class="timestamp">{{ r.data.input_count }} 条 / {{ r.data.todo_done }} 完成</span>
        </button>
      </div>
    </aside>

    <div v-if="report" class="weekly__main glass-panel">
      <header class="weekly__header">
        <div>
          <h1 class="weekly__title">📋 InfoStation 周报</h1>
          <div class="timestamp">{{ rangeText(report) }} · 生成于 {{ report.created_at.slice(0, 10) }}</div>
        </div>
        <button class="btn btn--glass btn--sm" :disabled="loading" @click="load(true)">
          <span v-if="loading" class="spinner" />
          🔄 重新生成
        </button>
      </header>

      <section class="weekly__section">
        <h2>📊 本周数据</h2>
        <div class="weekly__kpis">
          <div class="weekly__kpi">
            <span class="weekly__kpi-num">{{ report.data.input_count }}</span>
            <span class="weekly__kpi-label">输入信息</span>
          </div>
          <div class="weekly__kpi">
            <span class="weekly__kpi-num">{{ report.data.todo_created }}</span>
            <span class="weekly__kpi-label">提取 TODO</span>
          </div>
          <div class="weekly__kpi">
            <span class="weekly__kpi-num">{{ report.data.todo_done }}</span>
            <span class="weekly__kpi-label">完成 TODO</span>
          </div>
          <div class="weekly__kpi">
            <span class="weekly__kpi-num">{{ report.data.completion_rate }}%</span>
            <span class="weekly__kpi-label">完成率</span>
          </div>
        </div>
      </section>

      <section v-if="report.data.top_tags?.length" class="weekly__section">
        <h2>🔥 本周高频标签</h2>
        <div class="weekly__tags">
          <span v-for="t in report.data.top_tags" :key="t" class="tag-chip">#{{ t }}</span>
        </div>
      </section>

      <section v-if="report.data.completed_todos?.length" class="weekly__section">
        <h2>✅ 本周完成</h2>
        <ul class="weekly__list">
          <li v-for="t in report.data.completed_todos" :key="t.id">
            <span class="weekly__done-check">✅</span>
            <span>{{ t.title }}</span>
            <span class="timestamp">{{ CATEGORY_MAP[t.category]?.label }}</span>
          </li>
        </ul>
      </section>

      <section v-if="report.data.pending_next_week?.length" class="weekly__section">
        <h2>📌 待执行（下周重点）</h2>
        <ul class="weekly__list">
          <li v-for="t in report.data.pending_next_week" :key="t.id">
            <span class="priority-dot" :class="`priority-dot--${t.priority}`" />
            <span class="weekly__pending-title">□ {{ t.title }}</span>
            <span v-if="t.deadline" class="timestamp">截止 {{ t.deadline.slice(5) }}</span>
          </li>
        </ul>
      </section>

      <section v-if="report.data.agent_suggestions?.length" class="weekly__section">
        <h2>💡 Agent 建议</h2>
        <ul class="weekly__suggestions">
          <li v-for="(s, i) in report.data.agent_suggestions" :key="i">{{ s }}</li>
        </ul>
      </section>
    </div>

    <EmptyState
      v-else-if="!loading"
      icon="📋"
      title="还没有周报"
      desc="本周处理信息后自动生成"
    />
  </div>
</template>

<style scoped>
/* 杂志布局：左时间轴 + 右宽幅磨砂文档 */
.weekly {
  display: grid;
  grid-template-columns: 264px minmax(0, 1fr);
  grid-template-areas: 'rail doc';
  gap: var(--space-9);
  align-items: start;
}

.weekly__main {
  grid-area: doc;
  padding: var(--space-13) var(--space-14);
}

/* 文档抬头：标题下压一条发丝线，杂志刊头感 */
.weekly__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-5);
  padding-bottom: var(--space-7);
  margin-bottom: var(--space-9);
  border-bottom: 1px solid var(--glass-border);
  flex-wrap: wrap;
}
.weekly__title { font: var(--font-h1); }

.weekly__section { margin-bottom: var(--space-9); }
.weekly__section h2 {
  font: var(--font-caption);
  font-weight: 700;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 1.2px;
  margin-bottom: var(--space-6);
}

.weekly__kpis {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-7);
}
.weekly__kpi {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-7);
  background: var(--glass-bg-faint);
  border-radius: var(--radius-md);
}
.weekly__kpi-num {
  font: 700 28px/1.2 var(--font-family);
  letter-spacing: -1px;
  background: var(--gradient-1);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.weekly__kpi-label { font: var(--font-caption); color: var(--text-secondary); }

.weekly__tags { display: flex; flex-wrap: wrap; gap: var(--space-3); }

.weekly__list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.weekly__list li {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  font: var(--font-secondary);
}
.weekly__done-check { font-size: 12px; }
.weekly__pending-title { flex: 1; }
.weekly__list .timestamp { margin-left: auto; }

.weekly__suggestions {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-7);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background:
    linear-gradient(var(--glass-bg-strong), var(--glass-bg-strong)) padding-box,
    var(--gradient-agent) border-box;
}
.weekly__suggestions li {
  font: var(--font-secondary);
  color: var(--text-primary);
  line-height: 1.7;
  padding-left: var(--space-7);
  position: relative;
}
.weekly__suggestions li::before {
  content: '💡';
  position: absolute;
  left: 0;
  font-size: 12px;
}

/* ===== 历史周报时间轴（左侧竖轨 + 节点圆点） ===== */
.weekly__history {
  grid-area: rail;
  position: sticky;
  top: 96px;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.weekly__history-title { font: var(--font-h3); margin-bottom: var(--space-3); }

.weekly__timeline {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-left: var(--space-6);
}
.weekly__timeline::before {
  content: '';
  position: absolute;
  left: 5px;
  top: 10px;
  bottom: 10px;
  width: 1.5px;
  background: linear-gradient(180deg, var(--accent-blue), var(--glass-border));
  border-radius: 1px;
}

.weekly__history-item {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-5) var(--space-6);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  font: var(--font-secondary);
  color: var(--text-primary);
  text-align: left;
  transition: all var(--transition-fast);
}
.weekly__history-item:hover { background: var(--glass-hover); }
.weekly__timeline-dot {
  position: absolute;
  left: calc(-1 * var(--space-6) - 5.5px);
  top: 20px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--bg-secondary);
  border: 2px solid var(--accent-blue);
}
.weekly__history-item.is-active {
  border-color: var(--accent-blue);
  background: var(--glass-bg-strong);
  box-shadow: 0 0 12px rgba(37, 99, 235, 0.2), inset 0 1px 0 var(--glass-highlight);
}
.weekly__history-item.is-active .weekly__timeline-dot {
  background: var(--accent-blue);
  box-shadow: 0 0 8px rgba(37, 99, 235, 0.5);
}
.weekly__history-range { font-weight: 600; }

@media (max-width: 1024px) {
  .weekly {
    grid-template-columns: 1fr;
    grid-template-areas: 'doc' 'rail';
  }
  .weekly__history { position: static; }
}
@media (max-width: 768px) {
  .weekly__kpis { grid-template-columns: repeat(2, 1fr); }
  .weekly__main { padding: var(--space-9); }
}
</style>
