<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useTodosStore } from '../stores/todos';
import { useItemsStore } from '../stores/items';
import { GOAL_COLUMNS, CATEGORY_MAP, PRIORITY_MAP } from '../constants';
import TodoItem from '../components/TodoItem.vue';
import ItemDetailModal from '../components/ItemDetailModal.vue';
import EmptyState from '../components/EmptyState.vue';
import { toastError, toastSuccess } from '../stores/toast';

const todosStore = useTodosStore();
const itemsStore = useItemsStore();

const view = ref('today'); // today | board | all | done
const newTodoTitle = ref('');
const newTodoCategory = ref('growth');
const creating = ref(false);
const detailItem = ref(null);

const VIEW_TABS = [
  { key: 'today', label: '今日待办', icon: '📅' },
  { key: 'board', label: '目标看板', icon: '🎯' },
  { key: 'all', label: '全部', icon: '📋' },
  { key: 'done', label: '完成记录', icon: '🏆' },
];

async function load() {
  const params =
    view.value === 'today' ? { view: 'today' }
    : view.value === 'done' ? { view: 'done' }
    : { view: 'pending' };
  await todosStore.load(params);
}

onMounted(load);
watch(view, load);

// 目标看板按三列分组
const goalGroups = computed(() =>
  GOAL_COLUMNS.map((col) => ({
    ...col,
    todos: todosStore.list.filter((t) => t.category === col.key),
  }))
);

const otherTodos = computed(() => todosStore.list.filter((t) => !GOAL_COLUMNS.some((c) => c.key === t.category)));

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
    await todosStore.create({ title, category: newTodoCategory.value, priority: 'medium' });
    newTodoTitle.value = '';
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
        placeholder="手动添加 TODO（如：完成个人定位语初稿）…"
        @keydown.enter="createTodo"
      />
      <select v-model="newTodoCategory" class="glass-select glass-input todos-view__create-select">
        <option v-for="(c, key) in CATEGORY_MAP" :key="key" :value="key">{{ c.icon }} {{ c.label }}</option>
      </select>
      <button class="btn btn--primary" :disabled="!newTodoTitle.trim() || creating" @click="createTodo">
        {{ creating ? '创建中…' : '＋ 添加' }}
      </button>
    </div>

    <div class="todos-view__tabs">
      <button
        v-for="t in VIEW_TABS"
        :key="t.key"
        class="filter-chip"
        :class="{ 'is-active': view === t.key }"
        @click="view = t.key"
      >
        {{ t.icon }} {{ t.label }}
        <span v-if="t.key === 'today' && todosStore.todaySummary" class="todos-view__count">
          {{ todosStore.todaySummary.pending_count }}
        </span>
      </button>
    </div>

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

    <!-- 目标看板 -->
    <template v-else-if="view === 'board'">
      <div class="todos-view__board">
        <section v-for="col in goalGroups" :key="col.key" class="glass-panel todos-view__col">
          <header class="todos-view__col-header">
            <span>{{ col.icon }} {{ col.label }}</span>
            <span class="todos-view__count">{{ col.todos.length }}</span>
          </header>
          <div class="todos-view__col-body">
            <TodoItem v-for="t in col.todos" :key="t.id" :todo="t" compact @open-source="openSource" />
            <div v-if="!col.todos.length" class="timestamp todos-view__col-empty">暂无待办</div>
          </div>
        </section>
      </div>
      <div v-if="otherTodos.length" class="todos-view__other">
        <h3 class="todos-view__other-title">其他领域（认知成长 / 工具 / 存档）</h3>
        <div class="todos-view__list">
          <TodoItem v-for="t in otherTodos" :key="t.id" :todo="t" compact @open-source="openSource" />
        </div>
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

.todos-view__tabs { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.todos-view__count {
  padding: 0 8px;
  font: var(--font-micro);
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-full);
}
.filter-chip.is-active .todos-view__count { color: #fff; background: rgba(255, 255, 255, 0.2); }

.todos-view__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.todos-view__board {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-7);
}

.todos-view__col-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font: var(--font-h3);
  padding: var(--space-7) var(--space-9);
  border-bottom: 1px solid var(--glass-border);
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
