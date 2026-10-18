<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useTodosStore } from '../stores/todos';
import { useItemsStore } from '../stores/items';
import { useTopicsStore } from '../stores/topics';
import TodoItem from '../components/TodoItem.vue';
import ItemDetailModal from '../components/ItemDetailModal.vue';
import EmptyState from '../components/EmptyState.vue';
import SegmentTabs from '../components/SegmentTabs.vue';
import { toastError, toastSuccess } from '../stores/toast';
import { useLiveReload } from '../api/live';

const todosStore = useTodosStore();
const itemsStore = useItemsStore();
const topicsStore = useTopicsStore();

const view = ref('today'); // today | board | all | done
const newTodoTitle = ref('');
const newTodoTopic = ref('');   // '' = 不挂主题
const newTodoDeadline = ref(''); // YYYY-MM-DD 可空
const creating = ref(false);
const detailItem = ref(null);

const VIEW_TABS = [
  { key: 'today', label: '今日待办', icon: '📅' },
  { key: 'board', label: '主题看板', icon: '🎯' },
  { key: 'all', label: '全部', icon: '📋' },
  { key: 'done', label: '完成记录', icon: '🏆' },
];

// 今日 tab 带待办计数徽章
const tabsWithCount = computed(() =>
  VIEW_TABS.map((t) =>
    t.key === 'today' && todosStore.todaySummary
      ? { ...t, count: todosStore.todaySummary.pending_count }
      : t
  )
);

async function load() {
  // 面板只显示 TODO 线（行动项）；自媒体线的内容工序在「内容生产」视图
  const base = { line: 'trial' };
  const params =
    view.value === 'today' ? { ...base, view: 'today' }
    : view.value === 'done' ? { ...base, view: 'done' }
    : { ...base, view: 'pending' };
  await Promise.all([todosStore.load(params), topicsStore.load()]);
}

onMounted(load);
watch(view, load);

// SSE：CLI/其他端落库或改 TODO 后，本视图自动重拉
useLiveReload(load, ['todos', 'topics']);

// 主题看板：按长期主题分泳道（v2.1 取代旧 category 三列），未挂主题的进「未归档」
const boardLanes = computed(() => {
  const lanes = topicsStore.active.map((t) => ({
    key: `t-${t.id}`,
    label: t.name,
    icon: t.icon,
    color: t.color,
    todos: todosStore.list.filter((x) => x.topic_id === t.id),
  }));
  const unfiled = todosStore.list.filter((x) => !x.topic_id);
  if (unfiled.length) {
    lanes.push({
      key: '__none__',
      label: '未挂主题',
      icon: '🗂',
      color: 'var(--text-secondary)',
      todos: unfiled,
    });
  }
  return lanes;
});

const doneStats = computed(() => {
  const done = todosStore.list;
  const high = done.filter((t) => t.priority === 'high').length;
  return { total: done.length, high };
});

async function createTodo() {
  const title = newTodoTitle.value.trim();
  if (!title) return;
  creating.value = true;
  try {
    await todosStore.create({
      title,
      line: 'trial',
      topic_id: newTodoTopic.value || undefined,
      actual_deadline: newTodoDeadline.value || undefined,
    });
    newTodoTitle.value = '';
    newTodoDeadline.value = '';
    toastSuccess('TODO 已创建');
  } catch (e) {
    toastError(e.message);
  } finally {
    creating.value = false;
  }
}

async function openSource(todo) {
  if (!todo.source_item_id) return;
  detailItem.value = await itemsStore.getDetail(todo.source_item_id);
}
</script>

<template>
  <div class="todos-view">
    <div class="glass-panel todos-view__create">
      <input
        v-model="newTodoTitle"
        class="glass-input todos-view__create-input"
        placeholder="手动添加行动项（如：跑通 ESP32 第一个 demo）…"
        @keydown.enter="createTodo"
      />
      <select v-model="newTodoTopic" class="glass-select glass-input todos-view__create-select">
        <option value="">🗂 不挂主题</option>
        <option v-for="t in topicsStore.active" :key="t.id" :value="String(t.id)">{{ t.icon }} {{ t.name }}</option>
      </select>
      <input
        v-model="newTodoDeadline"
        type="date"
        class="glass-input todos-view__create-date"
        title="截止日期（可空）"
      />
      <button class="btn btn--primary" :disabled="!newTodoTitle.trim() || creating" @click="createTodo">
        {{ creating ? '创建中…' : '＋ 添加' }}
      </button>
    </div>

    <SegmentTabs v-model="view" :tabs="tabsWithCount" class="todos-view__tabs" />

    <!-- 今日待办 / 全部 -->
    <template v-if="view === 'today' || view === 'all'">
      <div v-if="todosStore.list.length" class="todos-view__list">
        <TodoItem
          v-for="t in todosStore.list"
          :key="t.id"
          :todo="t"
          @open-source="openSource"
        />
      </div>
      <EmptyState
        v-else
        icon="🎉"
        :title="view === 'today' ? '今天没有到期待办' : '暂无待执行 TODO'"
        desc="处理信息后 Agent 会自动提取可执行 TODO；也可以在上方手动添加"
      />
    </template>

    <!-- 主题看板：按长期主题分泳道 -->
    <template v-else-if="view === 'board'">
      <div class="todos-view__board">
        <section
          v-for="lane in boardLanes"
          :key="lane.key"
          class="glass-panel todos-view__col"
          :style="{ '--lane-color': lane.color }"
        >
          <header class="todos-view__col-header">
            <span>{{ lane.icon }} {{ lane.label }}</span>
            <span class="todos-view__count">{{ lane.todos.length }}</span>
          </header>
          <div class="todos-view__col-body">
            <TodoItem v-for="t in lane.todos" :key="t.id" :todo="t" compact @open-source="openSource" />
            <div v-if="!lane.todos.length" class="timestamp todos-view__col-empty">暂无待办</div>
          </div>
        </section>
      </div>
    </template>

    <!-- 完成记录 -->
    <template v-else>
      <div class="todos-view__done-stats">
        <span class="timestamp">🏆 累计完成 {{ doneStats.total }} 条 · 其中高优先级 {{ doneStats.high }} 条</span>
      </div>
      <div v-if="todosStore.list.length" class="todos-view__list">
        <TodoItem v-for="t in todosStore.list" :key="t.id" :todo="t" @open-source="openSource" />
      </div>
      <EmptyState v-else icon="🥁" title="还没有完成记录" desc="完成一条 TODO 后会出现在这里" />
    </template>

    <ItemDetailModal
      v-if="detailItem"
      :item="detailItem"
      @close="detailItem = null"
      @updated="load"
      @deleted="detailItem = null; load()"
      @open-related="openSource({ source_item_id: $event })"
    />
  </div>
</template>

<style scoped>
.todos-view { display: flex; flex-direction: column; gap: var(--space-8); }

.todos-view__create {
  display: flex;
  gap: var(--space-4);
  padding: var(--space-7);
}
.todos-view__create-input { flex: 1; }
.todos-view__create-select { width: auto; flex-shrink: 0; }
.todos-view__create-date {
  width: auto;
  flex-shrink: 0;
  font: var(--font-secondary);
  color: var(--text-secondary);
}

.todos-view__tabs { align-self: flex-start; }
.todos-view__count {
  padding: 0 8px;
  font: var(--font-micro);
  color: var(--text-secondary);
  background: rgba(15, 23, 42, 0.06);
  border-radius: var(--radius-full);
}

.todos-view__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* 主题看板：磨砂玻璃泳道（淡色底 + 主题色顶线），列数随主题自适应 */
.todos-view__board {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-7);
}

.todos-view__col {
  background: color-mix(in srgb, var(--lane-color) 6%, var(--glass-bg));
  border-top: 2px solid color-mix(in srgb, var(--lane-color) 55%, transparent);
}

.todos-view__col-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font: var(--font-h3);
  padding: var(--space-7) var(--space-9);
  border-bottom: 1px solid var(--glass-border);
}
.todos-view__col-header .todos-view__count {
  color: var(--lane-color);
  background: color-mix(in srgb, var(--lane-color) 12%, transparent);
}
.todos-view__col-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-7);
}
.todos-view__col-empty { text-align: center; padding: var(--space-7); }

.todos-view__other { margin-top: var(--space-5); }
.todos-view__other-title {
  font: var(--font-caption);
  color: var(--text-secondary);
  margin-bottom: var(--space-5);
}

.todos-view__done-stats { padding: var(--space-4) var(--space-5); }

@media (max-width: 1024px) {
  .todos-view__board { grid-template-columns: 1fr; }
}
@media (max-width: 768px) {
  .todos-view__create { flex-direction: column; }
  .todos-view__create-select { width: 100%; }
}
</style>
