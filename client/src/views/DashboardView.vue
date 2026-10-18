<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useItemsStore } from '../stores/items';
import { useTodosStore } from '../stores/todos';
import { useTopicsStore } from '../stores/topics';
import { fetchTodos, patchTodo } from '../api';
import { LINE_MAP, timeAgo } from '../constants';
import QuickInput from '../components/QuickInput.vue';
import ItemDetailModal from '../components/ItemDetailModal.vue';
import EmptyState from '../components/EmptyState.vue';
import { toastError, toastSuccess } from '../stores/toast';
import { useLiveReload } from '../api/live';

const router = useRouter();
const itemsStore = useItemsStore();
const todosStore = useTodosStore();
const topicsStore = useTopicsStore();
const quickInput = ref(null);

const recentItems = ref([]);
const mediaWorkflows = ref([]);
const detailItem = ref(null);

async function loadAll() {
  const [, mediaRes] = await Promise.all([
    itemsStore.load(1),
    // 工作台的今日 TODO 只显示 TODO 线（行动项）；内容工序在「内容生产」视图
    todosStore.load({ view: 'today', line: 'trial' }),
    topicsStore.load(),
    fetchTodos({ view: 'pending', line: 'media' }),
  ]);
  mediaWorkflows.value = mediaRes?.todos || [];
  // 最近处理取前 5（items store 已按时间倒序）
  recentItems.value = itemsStore.list.slice(0, 5);
}

onMounted(loadAll);

// SSE：任何端落库（卡片/TODO/主题）后，工作台自动刷新
useLiveReload(loadAll, ['items', 'todos', 'topics']);

function onProcessed() {
  loadAll();
}

const todayDone = computed(() => todosStore.list.filter((t) => t.status === 'done').length);
const todayTotal = computed(() => todosStore.list.length);

// 今日 TODO 直接打勾（工作台即战场，不用跳 /todos）
async function toggleTodo(t) {
  try {
    const next = t.status === 'done' ? 'pending' : 'done';
    await todosStore.update(t.id, { status: next });
    if (next === 'done') toastSuccess('已完成 ✓');
  } catch (e) {
    toastError(e.message);
  }
}

// ===== Agent 建议：每条必须是「具体发现 + 唯一动作」，不出正确的废话 =====
const pendingToday = computed(() => todosStore.list.filter((t) => t.status !== 'done'));

const agentSuggestion = computed(() => {
  // 情况 1：今日有待办未动 → 直接给「完成 / 顺延」两个真按钮
  const due = pendingToday.value[0];
  if (due) {
    return {
      icon: '⏱',
      text: `「${due.title}」今日到期，趁热清掉它（今日还有 ${pendingToday.value.length} 项未动）。`,
      actions: [
        { label: '☑️ 标记完成', run: () => toggleTodo(due), primary: true },
        {
          label: '⏰ 顺延明天',
          run: async () => {
            try {
              await patchTodo(due.id, { actual_deadline: new Date(Date.now() + 86400000).toISOString().slice(0, 10) });
              toastSuccess('已顺延到明天');
              loadAll();
            } catch (e) { toastError(e.message); }
          },
        },
      ],
    };
  }
  // 情况 2：内容生产有工序停滞 → 给入口去推进
  if (mediaWorkflows.value.length) {
    const stalled = mediaWorkflows.value[0];
    return {
      icon: '✍️',
      text: `内容生产里《${stalled.source_item_title || stalled.title}》还有 ${mediaWorkflows.value.length} 项工序待推进，先把第一步做掉？`,
      actions: [{ label: '⚡ 去推进工序', run: () => router.push('/content'), primary: true }],
    };
  }
  // 情况 3：主题空转 → 引导录入第一条（聚焦输入框并预选主题）
  const emptyTopic = topicsStore.active.find((t) => !t.item_count);
  if (emptyTopic) {
    return {
      icon: emptyTopic.icon,
      text: `主题「${emptyTopic.name}」还是 0 张卡片，先记一条最近的实践或复盘？`,
      actions: [{
        label: '✍️ 记一条',
        run: () => quickInput.value?.focusWithTopic(emptyTopic.id),
        primary: true,
      }],
    };
  }
  return {
    icon: '🎯',
    text: `今日待办已清空。信息库共 ${itemsStore.total} 张卡片，挑一张没跑完的继续？`,
    actions: [{ label: '去看看卡片', run: () => router.push('/knowledge'), primary: true }],
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
    <!-- C 位：流光玻璃命令框（主题选择 + Agent 技能开关在框内） -->
    <QuickInput ref="quickInput" @processed="onProcessed" />

    <!-- Bento Grid：左栏今日 TODO（50%），右侧建议 + 最近处理 -->
    <div class="dashboard__bento">
      <!-- 左栏 · 今日 TODO（line=trial，可直接打勾） -->
      <section class="glass-panel dashboard__todos">
        <div class="panel-header">
          <h2>✅ 今日 TODO（{{ todayDone }}/{{ todayTotal }}）</h2>
          <RouterLink to="/todos" class="panel-more">查看全部 →</RouterLink>
        </div>
        <div v-if="todosStore.list.length" class="dashboard__todo-list">
          <div v-for="t in todosStore.list.slice(0, 6)" :key="t.id" class="dashboard__todo" :class="{ 'is-done': t.status === 'done' }">
            <button class="dashboard__todo-check" :class="{ 'is-checked': t.status === 'done' }" @click="toggleTodo(t)">
              <span v-if="t.status === 'done'">✓</span>
            </button>
            <span class="dashboard__todo-title">{{ t.title }}</span>
            <span v-if="t.topic_id" class="dashboard__todo-topic">{{ topicsStore.nameOf(t.topic_id) }}</span>
            <span class="priority-dot" :class="`priority-dot--${t.priority}`" />
          </div>
        </div>
        <EmptyState
          v-else
          icon="🎉"
          title="今天没有待办"
          desc="处理新信息后，可执行的 TODO 会出现在这里"
        />
      </section>

      <!-- 右上 · Agent 建议（发现 + 动作，无废话版） -->
      <section v-if="agentSuggestion" class="dashboard__advice">
        <div class="dashboard__advice-inner">
          <div class="dashboard__advice-head">
            <span class="dashboard__advice-icon">{{ agentSuggestion.icon }}</span>
            <span class="dashboard__advice-label">私秘建议 · Agent</span>
          </div>
          <p class="dashboard__advice-text">{{ agentSuggestion.text }}</p>
          <div class="dashboard__advice-actions">
            <button
              v-for="a in agentSuggestion.actions"
              :key="a.label"
              class="btn btn--sm dashboard__advice-btn"
              :class="a.primary ? 'btn--primary' : 'btn--glass'"
              @click="a.run"
            >
              {{ a.label }}
            </button>
          </div>
        </div>
      </section>

      <!-- 右下 · 最近处理（主题胶囊 + 业务线色点） -->
      <section class="glass-panel dashboard__recent">
        <div class="panel-header">
          <h2>🧠 最近处理</h2>
          <RouterLink to="/knowledge" class="panel-more">查看全部 →</RouterLink>
        </div>
        <div v-if="recentItems.length" class="dashboard__recent-list">
          <button v-for="it in recentItems" :key="it.id" class="dashboard__recent-item" @click="openDetail(it)">
            <span v-if="it.topic_name" class="dashboard__recent-topic">{{ it.topic_name }}</span>
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
.dashboard__todo.is-done .dashboard__todo-title { text-decoration: line-through; opacity: 0.55; }
.dashboard__todo-title {
  flex: 1;
  font: var(--font-secondary);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dashboard__todo-topic {
  font: var(--font-micro);
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  padding: 2px 9px;
  border-radius: var(--radius-full);
  white-space: nowrap;
}
.dashboard__todo-check {
  width: 19px;
  height: 19px;
  min-width: 19px;
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
.dashboard__todo-check:hover { border-color: var(--accent-green); box-shadow: 0 0 8px rgba(5, 150, 105, 0.3); }
.dashboard__todo-check.is-checked { background: var(--accent-green); border-color: var(--accent-green); }

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
.dashboard__advice-actions {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
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
.dashboard__recent-topic {
  font: var(--font-micro);
  color: var(--accent-blue);
  background: rgba(37, 99, 235, 0.08);
  border: 1px solid rgba(37, 99, 235, 0.25);
  padding: 2px 9px;
  border-radius: var(--radius-full);
  white-space: nowrap;
}
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
