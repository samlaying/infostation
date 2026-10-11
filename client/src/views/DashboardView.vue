<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useItemsStore } from '../stores/items';
import { useTodosStore } from '../stores/todos';
import { useStatsStore } from '../stores/stats';
import { CATEGORY_MAP, PRIORITY_MAP, timeAgo } from '../constants';
import QuickInput from '../components/QuickInput.vue';
import StatCard from '../components/StatCard.vue';
import ItemDetailModal from '../components/ItemDetailModal.vue';
import EmptyState from '../components/EmptyState.vue';

const router = useRouter();
const itemsStore = useItemsStore();
const todosStore = useTodosStore();
const statsStore = useStatsStore();

const recentItems = ref([]);
const detailItem = ref(null);

async function loadAll() {
  const [itemsRes] = await Promise.all([
    itemsStore.load(1),
    todosStore.load({ view: 'today' }),
    statsStore.load(),
  ]);
  // 最近处理取前 5（items store 已按时间倒序）
  recentItems.value = itemsStore.list.slice(0, 5);
}

onMounted(loadAll);

function onProcessed() {
  loadAll();
}

const todayDone = computed(
  () => todosStore.list.filter((t) => t.status === 'done').length
);
const todayTotal = computed(() => todosStore.list.length);

// Agent 建议（规则：对应 PRD 九、智能建议）
const agentSuggestion = computed(() => {
  const s = statsStore.data;
  if (!s) return null;
  const goals = s.goal_progress || [];
  // 高优先级积压提醒
  const backlog = goals.reduce((a, g) => a + g.total - g.done, 0);
  const worst = [...goals].sort((a, b) => (b.total - b.done) - (a.total - a.done))[0];
  if (worst && worst.total - worst.done >= 5) {
    return {
      icon: '📌',
      text: `「${CATEGORY_MAP[worst.category].label}」方向 TODO 积压 ${worst.total - worst.done} 条未完成，建议优先清理，避免收藏 ≠ 行动。`,
      action: { label: '查看 TODO 面板', to: '/todos' },
    };
  }
  // 收集多执行少
  const weekItems = s.items.month_new;
  if (weekItems >= 20 && s.todos.week_rate < 0.4) {
    return {
      icon: '💡',
      text: `本月已收集 ${s.items.month_new} 条信息，但本周 TODO 完成率仅 ${Math.round(s.todos.week_rate * 100)}%。建议暂缓收集，先执行已有计划。`,
      action: { label: '查看未完成 TODO', to: '/todos' },
    };
  }
  return {
    icon: '🤖',
    text: '今日节奏健康。继续把碎片信息丢给私秘，让它帮你变成行动清单。',
    action: null,
  };
});

async function openDetail(item) {
  detailItem.value = await itemsStore.getDetail(item.id);
}

async function openDetailById(id) {
  detailItem.value = await itemsStore.getDetail(id);
}
</script>

<template>
  <div class="dashboard">
    <!-- 快速输入 -->
    <QuickInput @processed="onProcessed" />

    <!-- 统计行 -->
    <div v-if="statsStore.data" class="dashboard__stats">
      <StatCard
        v-for="(s, i) in [
          { label: '总信息量', value: statsStore.data.items.total, icon: '📊', deltaText: `+${statsStore.data.items.today_new} 今日`, deltaTone: 'up', gradient: 'var(--gradient-1)' },
          { label: 'TODO', value: statsStore.data.todos.total, icon: '✅', deltaText: `完成 ${Math.round(statsStore.data.todos.completion_rate * 100)}%`, deltaTone: 'flat', gradient: 'var(--gradient-2)' },
          { label: '今日新增', value: statsStore.data.items.today_new, icon: '📥', deltaText: `昨日 ${statsStore.data.items.yesterday_new}`, deltaTone: 'flat', gradient: 'var(--gradient-3)' },
          { label: '本周完成', value: statsStore.data.todos.week_done, icon: '🎯', deltaText: `完成率 ${Math.round(statsStore.data.todos.week_rate * 100)}%`, deltaTone: 'up', gradient: 'var(--gradient-success)' },
        ]"
        :key="s.label"
        v-bind="s"
        :index="i"
      />
    </div>

    <div class="dashboard__grid">
      <!-- 今日 TODO -->
      <section class="glass-panel dashboard__todos">
        <div class="panel-header">
          <h2>✅ 今日 TODO（{{ todayDone }}/{{ todayTotal }}）</h2>
          <RouterLink to="/todos" class="panel-more">查看全部 →</RouterLink>
        </div>
        <div v-if="todosStore.list.length" class="dashboard__todo-list">
          <div v-for="t in todosStore.list.slice(0, 6)" :key="t.id" class="dashboard__todo">
            <span class="priority-dot" :class="`priority-dot--${t.priority}`" />
            <span class="dashboard__todo-title">{{ t.title }}</span>
            <span class="dashboard__todo-cat" :style="{ color: CATEGORY_MAP[t.category]?.color }">
              {{ CATEGORY_MAP[t.category]?.label }}
            </span>
          </div>
        </div>
        <EmptyState
          v-else
          icon="🎉"
          title="今天没有待办"
          desc="处理新信息后，可执行的 TODO 会出现在这里"
        />
      </section>

      <!-- 最近处理 -->
      <section class="glass-panel dashboard__recent">
        <div class="panel-header">
          <h2>🧠 最近处理</h2>
          <RouterLink to="/knowledge" class="panel-more">查看全部 →</RouterLink>
        </div>
        <div v-if="recentItems.length" class="dashboard__recent-list">
          <button v-for="it in recentItems" :key="it.id" class="dashboard__recent-item" @click="openDetail(it)">
            <span class="dashboard__recent-cat">{{ CATEGORY_MAP[it.primary_category]?.icon }}</span>
            <span class="dashboard__recent-title">{{ it.title }}</span>
            <span v-if="it.todo_count" class="dashboard__recent-badge">✅ {{ it.todo_count }}</span>
            <span class="priority-dot" :class="`priority-dot--${it.priority}`" :title="`${PRIORITY_MAP[it.priority]?.label}优先级`" />
            <span class="timestamp">{{ timeAgo(it.created_at) }}</span>
          </button>
        </div>
        <EmptyState v-else icon="📭" title="还没有处理记录" desc="把链接或文字粘贴到上方输入框试试" />
      </section>
    </div>

    <!-- Agent 建议 -->
    <section v-if="agentSuggestion" class="glass-panel dashboard__advice">
      <div class="dashboard__advice-icon">{{ agentSuggestion.icon }}</div>
      <div class="dashboard__advice-body">
        <div class="dashboard__advice-label">私秘建议</div>
        <p class="dashboard__advice-text">{{ agentSuggestion.text }}</p>
      </div>
      <button
        v-if="agentSuggestion.action"
        class="btn btn--glass btn--sm"
        @click="router.push(agentSuggestion.action.to)"
      >
        {{ agentSuggestion.action.label }}
      </button>
    </section>

    <ItemDetailModal
      v-if="detailItem"
      :item="detailItem"
      @close="detailItem = null"
      @updated="loadAll"
      @deleted="detailItem = null; loadAll()"
      @open-related="openDetailById"
    />
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: var(--space-9);
}

.dashboard__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-7);
}

.dashboard__grid {
  display: grid;
  grid-template-columns: 5fr 7fr;
  gap: var(--space-9);
}

.dashboard__todos,
.dashboard__recent {
  padding: var(--space-11);
}

.panel-more { font: var(--font-caption); color: var(--text-secondary); }
.panel-more:hover { color: var(--accent-cyan); }

.dashboard__todo-list { display: flex; flex-direction: column; gap: var(--space-4); }
.dashboard__todo {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-6);
  background: var(--glass-bg-faint);
  border-radius: var(--radius-sm);
}
.dashboard__todo-title {
  flex: 1;
  font: var(--font-secondary);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dashboard__todo-cat { font: var(--font-micro); }

.dashboard__recent-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.dashboard__recent-item {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-5) var(--space-6);
  border-radius: var(--radius-sm);
  text-align: left;
  transition: background var(--transition-fast);
}
.dashboard__recent-item:hover { background: var(--glass-hover); }
.dashboard__recent-cat { font-size: 15px; }
.dashboard__recent-title {
  flex: 1;
  font: var(--font-secondary);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dashboard__recent-badge {
  font: var(--font-micro);
  color: var(--accent-green);
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.25);
  padding: 2px 8px;
  border-radius: var(--radius-full);
}

.dashboard__advice {
  display: flex;
  align-items: center;
  gap: var(--space-7);
  padding: var(--space-9) var(--space-11);
  border-left: 3px solid;
  border-image: var(--gradient-2) 1;
}
.dashboard__advice-icon { font-size: 26px; }
.dashboard__advice-body { flex: 1; }
.dashboard__advice-label {
  font: var(--font-caption);
  color: var(--accent-cyan);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: var(--space-2);
}
.dashboard__advice-text { font: var(--font-secondary); line-height: 1.7; color: var(--text-primary); }

@media (max-width: 1024px) {
  .dashboard__grid { grid-template-columns: 1fr; }
}
</style>
