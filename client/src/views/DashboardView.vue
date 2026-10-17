<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useItemsStore } from '../stores/items';
import { useTodosStore } from '../stores/todos';
import { useStatsStore } from '../stores/stats';
import { CATEGORY_MAP, PRIORITY_MAP, timeAgo, LINE_MAP } from '../constants';
import QuickInput from '../components/QuickInput.vue';
import ItemDetailModal from '../components/ItemDetailModal.vue';
import EmptyState from '../components/EmptyState.vue';
import { useLiveReload } from '../api/live';

const router = useRouter();
const itemsStore = useItemsStore();
const todosStore = useTodosStore();
const statsStore = useStatsStore();

const recentItems = ref([]);
const detailItem = ref(null);

async function loadAll() {
  const [itemsRes] = await Promise.all([
    itemsStore.load(1),
    // 工作台的今日 TODO 只显示 TODO 线（行动项）；内容工序在「内容生产」视图
    todosStore.load({ view: 'today', line: 'trial' }),
    statsStore.load(),
  ]);
  // 最近处理取前 5（items store 已按时间倒序）
  recentItems.value = itemsStore.list.slice(0, 5);
}

onMounted(loadAll);

// SSE：任何端落库（卡片/TODO/主题）后，工作台自动刷新
useLiveReload(loadAll, ['items', 'todos', 'topics']);

function onProcessed() {
  loadAll();
}

const todayDone = computed(
  () => todosStore.list.filter((t) => t.status === 'done').length
);
const todayTotal = computed(() => todosStore.list.length);

// 顶栏微型胶囊状态（规格：替代原四张统计卡，一行看全局）
const microStats = computed(() => {
  const s = statsStore.data;
  if (!s) return [];
  return [
    { icon: '⚡', label: '今日待办', value: todayTotal.value },
    { icon: '🏆', label: '本周完成', value: s.todos.week_done },
    { icon: '📊', label: '信息总量', value: s.items.total },
  ];
});

// Agent 建议（规则：对应 PRD 九、智能建议）
const agentSuggestion = computed(() => {
  const s = statsStore.data;
  if (!s) return null;
  const goals = s.goal_progress || [];
  // 高优先级积压提醒
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
    <!-- C 位：流光玻璃命令框 -->
    <QuickInput @processed="onProcessed" />

    <!-- 微型胶囊状态行（替代原统计卡） -->
    <div v-if="microStats.length" class="dashboard__micro">
      <span v-for="m in microStats" :key="m.label" class="dashboard__micro-item">
        <span class="dashboard__micro-icon">{{ m.icon }}</span>
        <span class="dashboard__micro-label">{{ m.label }}</span>
        <b class="dashboard__micro-value">{{ m.value }}</b>
      </span>
    </div>

    <!-- Bento Grid：左栏今日 TODO（50%），右侧建议 + 最近处理 -->
    <div class="dashboard__bento">
      <!-- 左栏 · 今日 TODO（line=trial） -->
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

      <!-- 右上 · Agent 建议（紫粉极光玻璃便签） -->
      <section v-if="agentSuggestion" class="dashboard__advice">
        <div class="dashboard__advice-inner">
          <div class="dashboard__advice-head">
            <span class="dashboard__advice-icon">{{ agentSuggestion.icon }}</span>
            <span class="dashboard__advice-label">私秘建议 · Agent</span>
          </div>
          <p class="dashboard__advice-text">{{ agentSuggestion.text }}</p>
          <button
            v-if="agentSuggestion.action"
            class="btn btn--glass btn--sm dashboard__advice-btn"
            @click="router.push(agentSuggestion.action.to)"
          >
            {{ agentSuggestion.action.label }} →
          </button>
        </div>
      </section>

      <!-- 右下 · 最近处理（带业务线色点） -->
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
            <span
              class="line-dot"
              :class="`line-dot--${it.line || 'trial'}`"
              :title="LINE_MAP[it.line || 'trial']?.label"
            />
            <span class="timestamp">{{ timeAgo(it.created_at) }}</span>
          </button>
        </div>
        <EmptyState v-else icon="📭" title="还没有处理记录" desc="把链接或文字粘贴到上方输入框试试" />
      </section>
    </div>

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
  gap: var(--space-7);
}

/* ===== 微型胶囊状态行 ===== */
.dashboard__micro {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-5);
  flex-wrap: wrap;
}
.dashboard__micro-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  padding: 6px 14px;
  font: var(--font-caption);
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-full);
  backdrop-filter: blur(var(--blur-base));
  -webkit-backdrop-filter: blur(var(--blur-base));
}
.dashboard__micro-icon { font-size: 12px; }
.dashboard__micro-value { color: var(--text-primary); font-weight: 700; }

/* ===== Bento Grid ===== */
.dashboard__bento {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-areas:
    'todos advice'
    'todos recent';
  gap: var(--space-7);
  align-items: stretch;
}
.dashboard__todos { grid-area: todos; padding: var(--space-11); }
.dashboard__recent { grid-area: recent; padding: var(--space-11); }

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
  transition: background var(--transition-fast), transform var(--transition-fast);
}
.dashboard__todo:hover { background: var(--glass-hover); }
.dashboard__todo-title {
  flex: 1;
  font: var(--font-secondary);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dashboard__todo-cat { font: var(--font-micro); }

/* ===== Agent 建议：紫粉极光渐变描边玻璃便签 ===== */
.dashboard__advice {
  grid-area: advice;
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  background:
    linear-gradient(var(--glass-bg), var(--glass-bg)) padding-box,
    var(--gradient-agent) border-box;
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  box-shadow: 0 8px 32px rgba(147, 51, 234, 0.12), inset 0 1px 0 var(--glass-highlight);
}
.dashboard__advice-inner { padding: var(--space-9) var(--space-11); }
.dashboard__advice-head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}
.dashboard__advice-icon { font-size: 22px; }
.dashboard__advice-label {
  font: var(--font-caption);
  background: var(--gradient-agent);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.dashboard__advice-text {
  font: var(--font-secondary);
  line-height: 1.7;
  color: var(--text-primary);
  margin-bottom: var(--space-5);
}
.dashboard__advice-btn { pointer-events: auto; }

/* ===== 最近处理 ===== */
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
  background: rgba(5, 150, 105, 0.1);
  border: 1px solid rgba(5, 150, 105, 0.25);
  padding: 2px 8px;
  border-radius: var(--radius-full);
}

/* ===== 业务线色点（蓝=代试 / 橙=内容） ===== */
.line-dot {
  width: 7px;
  height: 7px;
  min-width: 7px;
  border-radius: 50%;
}
.line-dot--trial { background: var(--line-trial); box-shadow: 0 0 6px rgba(8, 145, 178, 0.5); }
.line-dot--media { background: var(--line-media); box-shadow: 0 0 6px rgba(234, 88, 12, 0.5); }

@media (max-width: 1024px) {
  .dashboard__bento {
    grid-template-columns: 1fr;
    grid-template-areas:
      'todos'
      'advice'
      'recent';
  }
  .dashboard__micro { justify-content: flex-start; }
}
</style>
