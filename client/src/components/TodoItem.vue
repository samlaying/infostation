<script setup>
import { computed } from 'vue';
import { CATEGORY_MAP, PRIORITY_MAP, timeAgo, fmtDate } from '../constants';
import { useTodosStore } from '../stores/todos';
import { toastError, toastSuccess, toast } from '../stores/toast';

const props = defineProps({
  todo: { type: Object, required: true },
  showSource: { type: Boolean, default: true },
  compact: { type: Boolean, default: false },
});

const emit = defineEmits(['open-source']);

const todosStore = useTodosStore();
const cat = computed(() => CATEGORY_MAP[props.todo.category] || CATEGORY_MAP.growth);
const isDone = computed(() => props.todo.status === 'done');
const isOverdue = computed(() => {
  if (isDone.value) return false;
  const d = props.todo.actual_deadline || props.todo.suggested_deadline;
  return d && d < new Date().toISOString().slice(0, 10);
});

async function toggleDone() {
  try {
    const next = isDone.value ? 'pending' : 'done';
    await todosStore.update(props.todo.id, { status: next });
    if (next === 'done') toastSuccess('TODO 已完成 ✓');
  } catch (e) {
    toastError(e.message);
  }
}

async function archive() {
  try {
    await todosStore.update(props.todo.id, { status: 'archived' });
    toast('已归档', 'info');
  } catch (e) {
    toastError(e.message);
  }
}
</script>

<template>
  <div class="todo-item glass-card glass-card--hover" :class="{ 'is-done': isDone }">
    <button
      class="todo-item__check"
      :class="{ 'is-checked': isDone }"
      :title="isDone ? '标记为待执行' : '标记为已完成'"
      @click="toggleDone"
    >
      <span v-if="isDone">✓</span>
    </button>

    <div class="todo-item__main">
      <div class="todo-item__title-row">
        <span class="todo-item__title">{{ todo.title }}</span>
        <span
          v-if="!compact"
          class="priority-dot"
          :class="`priority-dot--${todo.priority}`"
          :title="`${PRIORITY_MAP[todo.priority].label}优先级`"
        />
      </div>
      <div class="todo-item__meta">
        <span class="todo-item__cat" :style="{ color: cat.color }">{{ cat.icon }} {{ cat.label }}</span>
        <span
          v-if="todo.actual_deadline || todo.suggested_deadline"
          class="todo-item__deadline"
          :class="{ 'is-overdue': isOverdue }"
        >
          📅 {{ fmtDate(todo.actual_deadline || todo.suggested_deadline) }}
          <template v-if="isOverdue">· 已超期</template>
        </span>
        <span v-if="showSource && todo.source_item_id" class="todo-item__source" @click="emit('open-source', todo)">
          🔗 {{ todo.source_item_title || '查看来源' }}
        </span>
      </div>
    </div>

    <div class="todo-item__actions">
      <button v-if="!isDone && todo.status !== 'archived'" class="icon-btn" title="归档（不做了）" @click="archive">🗄</button>
      <span class="timestamp">{{ timeAgo(todo.created_at) }}</span>
    </div>
  </div>
</template>

<style scoped>
.todo-item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-5);
  padding: var(--space-6);
}
.todo-item.is-done { opacity: 0.55; }

.todo-item__check {
  width: 20px;
  height: 20px;
  min-width: 20px;
  margin-top: 2px;
  border: 1.5px solid var(--glass-border-hover);
  border-radius: 6px;
  color: #fff;
  font-size: 12px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
}
.todo-item__check:hover { border-color: var(--accent-green); }
.todo-item__check.is-checked {
  background: var(--accent-green);
  border-color: var(--accent-green);
}

.todo-item__main { flex: 1; min-width: 0; }

.todo-item__title-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.todo-item__title {
  font: var(--font-body);
  color: var(--text-primary);
}
.is-done .todo-item__title { text-decoration: line-through; }

.todo-item__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin-top: var(--space-2);
  font: var(--font-micro);
  color: var(--text-muted);
}
.todo-item__deadline.is-overdue { color: var(--accent-red); }
.todo-item__source { cursor: pointer; transition: color var(--transition-fast); }
.todo-item__source:hover { color: var(--accent-cyan); }

.todo-item__actions {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-shrink: 0;
}

.icon-btn {
  padding: 4px;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  font-size: 13px;
  transition: all var(--transition-fast);
}
.icon-btn:hover { color: var(--text-primary); background: var(--glass-hover); }
</style>
