<script setup>
// ===== 内容生产（自媒体线）=====
// 三区：选题库（tags 含「选题」）/ 内容工序（line=media 的 todos）/ 发布包（tags 含「发布包」）
// 数据独立拉取（不走 items/todos store，避免与信息库/TODO 面板互相覆盖）
import { ref, computed, onMounted } from 'vue';
import { fetchItems, fetchItem, fetchTodos, patchTodo, patchItem, processInput } from '../api';
import { LINE_MAP, MEDIA_ROLE_MAP, CATEGORY_MAP, PRIORITY_MAP, timeAgo } from '../constants';
import ItemDetailModal from '../components/ItemDetailModal.vue';
import EmptyState from '../components/EmptyState.vue';
import { toastError, toastSuccess, toast } from '../stores/toast';
import { useLiveReload } from '../api/live';

const topics = ref([]);        // 选题卡
const packages = ref([]);      // 发布包卡
const workflows = ref([]);     // 内容工序（line=media todos）
const loading = ref(true);
const detailItem = ref(null);

// 流水线步进器：选题 → 工序 → 发布包
const STEPS = [
  { key: '选题库', label: '选题库', icon: '💡' },
  { key: '内容工序', label: '内容工序', icon: '🔨' },
  { key: '发布包', label: '发布包', icon: '📦' },
];
const tab = ref('选题库');

async function load() {
  loading.value = true;
  try {
    const [t, p, w] = await Promise.all([
      fetchItems({ tag: '选题', line: 'media', page_size: 60 }),
      fetchItems({ tag: '发布包', line: 'media', page_size: 60 }),
      fetchTodos({ view: 'pending', line: 'media' }),
    ]);
    topics.value = t.items || [];
    packages.value = p.items || [];
    workflows.value = w.todos || [];
  } catch (e) {
    toastError(e.message);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// SSE：选题/工序/发布包任何一环变更后自动重拉三区
useLiveReload(load, ['items', 'todos', 'posts', 'assets']);

const counts = computed(() => ({
  选题库: topics.value.length,
  内容工序: workflows.value.length,
  发布包: packages.value.length,
}));

// 内容工序按来源选题分组
const workflowGroups = computed(() => {
  const groups = new Map();
  for (const w of workflows.value) {
    const key = w.source_item_id || '__none__';
    if (!groups.has(key)) {
      groups.set(key, { title: w.source_item_title || '（未关联选题）', todos: [] });
    }
    groups.get(key).todos.push(w);
  }
  return [...groups.values()];
});

function roleTags(tags) {
  return (tags || []).filter((t) => MEDIA_ROLE_MAP[t]);
}

// 卡包式排序：未发布在前，已发布置灰沉底
const sortedPackages = computed(() => {
  const isPub = (it) => (it.tags || []).includes('已发布');
  return [...packages.value].sort((a, b) => Number(isPub(a)) - Number(isPub(b)));
});

async function toggleWorkflow(todo) {
  try {
    const next = todo.status === 'done' ? 'pending' : 'done';
    const updated = await patchTodo(todo.id, { status: next });
    const i = workflows.value.findIndex((x) => x.id === todo.id);
    if (i !== -1) {
      if (next === 'done') workflows.value.splice(i, 1); // 完成即离开待办列表
      else workflows.value[i] = updated;
    }
    if (next === 'done') toastSuccess('工序已完成 ✓');
  } catch (e) {
    toastError(e.message);
  }
}

// 选题 → 标记已发布（给关联发布包卡打标签）
async function markPublished(item) {
  try {
    const tags = [...new Set([...(item.tags || []), '已发布'])];
    await patchItem(item.id, { tags });
    toastSuccess('已标记为「已发布」');
    await load();
  } catch (e) {
    toastError(e.message);
  }
}

async function openDetail(item) {
  detailItem.value = await fetchItem(item.id);
}

// 快速新建选题
const newTopic = ref('');
const creating = ref(false);
async function createTopic() {
  const title = newTopic.value.trim();
  if (!title) return;
  creating.value = true;
  try {
    const res = await processInput({
      content: `选题｜${title}`,
      line: 'media',
      preferred_category: 'media',
      user_note: `选题库｜来源=手动录入｜${new Date().toISOString().slice(0, 10)}`,
    });
    await patchItem(res.processed_item.id, {
      tags: [...new Set([...(res.processed_item.tags || []), '选题'])],
    });
    newTopic.value = '';
    toastSuccess('选题已加入选题库');
    await load();
  } catch (e) {
    toastError(e.message);
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <div class="content-view">
    <header class="content-view__head glass-panel">
      <div class="content-view__head-title">
        <span class="content-view__icon">{{ LINE_MAP.media.icon }}</span>
        <div>
          <h1>内容生产</h1>
          <p class="content-view__sub">{{ LINE_MAP.media.desc }}</p>
        </div>
      </div>
      <div class="content-view__head-stats">
        <span><b>{{ topics.length }}</b> 选题</span>
        <span><b>{{ workflows.length }}</b> 工序</span>
        <span><b>{{ packages.length }}</b> 发布包</span>
      </div>
    </header>

    <!-- 快速新建选题 -->
    <div class="glass-panel content-view__create">
      <input
        v-model="newTopic"
        class="glass-input content-view__create-input"
        placeholder="记一个选题（如：AI 副业的过程透明化）…"
        @keydown.enter="createTopic"
      />
      <button class="btn btn--primary" :disabled="!newTopic.trim() || creating" @click="createTopic">
        {{ creating ? '创建中…' : '＋ 新建选题' }}
      </button>
    </div>

    <!-- 流水线步进器：选题 ─▶ 工序 ─▶ 发布包 -->
    <div class="stepper" role="tablist">
      <template v-for="(s, i) in STEPS" :key="s.key">
        <span v-if="i > 0" class="stepper__link" aria-hidden="true" />
        <button
          class="stepper__step"
          :class="{ 'is-active': tab === s.key }"
          role="tab"
          :aria-selected="tab === s.key"
          @click="tab = s.key"
        >
          <span class="stepper__icon">{{ s.icon }}</span>
          <span class="stepper__label">{{ s.label }}</span>
          <span class="stepper__count">{{ counts[s.key] }}</span>
        </button>
      </template>
    </div>

    <!-- 选题库 -->
    <template v-if="tab === '选题库'">
      <div v-if="topics.length" class="content-view__grid">
        <button v-for="it in topics" :key="it.id" class="content-card glass-card glass-card--hover" @click="openDetail(it)">
          <div class="content-card__role">💡 选题</div>
          <h3 class="content-card__title">{{ it.title }}</h3>
          <p class="content-card__summary">{{ it.summary }}</p>
          <div class="content-card__meta">
            <span class="timestamp">{{ timeAgo(it.created_at) }}</span>
            <span v-if="it.todo_count" class="content-card__badge">⚙️ {{ it.todo_count }}</span>
          </div>
        </button>
      </div>
      <EmptyState v-else icon="💡" title="选题库还是空的" desc="在上方记一个选题，或让 Agent 搜素材后聚类沉淀" />
    </template>

    <!-- 内容工序（按来源选题分组） -->
    <template v-else-if="tab === '内容工序'">
      <div v-if="workflowGroups.length" class="content-view__groups">
        <section v-for="(g, gi) in workflowGroups" :key="gi" class="glass-panel content-view__group">
          <header class="content-view__group-head">
            <span class="content-view__group-title">{{ g.title }}</span>
            <span class="content-view__count">{{ g.todos.length }}</span>
          </header>
          <div class="content-view__group-body">
            <div v-for="w in g.todos" :key="w.id" class="content-view__task">
              <button class="content-view__check" :title="'标记完成'" @click="toggleWorkflow(w)">○</button>
              <span class="content-view__task-title">{{ w.title }}</span>
              <span class="priority-dot" :class="`priority-dot--${w.priority}`" />
            </div>
          </div>
        </section>
      </div>
      <EmptyState v-else icon="⚙️" title="没有待推进的内容工序" desc="录入媒体线素材后，Agent 会提取内容工序（撰写/拆解/成稿…）" />
    </template>

    <!-- 发布包（卡包式：未发布在前，已发布盖 PUBLISHED 印章置灰沉底） -->
    <template v-else>
      <div v-if="sortedPackages.length" class="content-view__grid">
        <article
          v-for="it in sortedPackages"
          :key="it.id"
          class="pack glass-card glass-card--hover"
          :class="{ 'pack--published': (it.tags || []).includes('已发布') }"
          @click="openDetail(it)"
        >
          <div class="pack__strip" aria-hidden="true" />
          <div class="pack__role">
            📦 发布包
            <span v-if="(it.tags || []).includes('已发布')" class="pack__stamp">PUBLISHED</span>
          </div>
          <h3 class="content-card__title">{{ it.title }}</h3>
          <p class="content-card__summary">{{ it.summary }}</p>
          <div class="content-card__meta">
            <span class="timestamp">{{ timeAgo(it.created_at) }}</span>
            <span
              v-if="!(it.tags || []).includes('已发布')"
              class="content-card__action"
              @click.stop="markPublished(it)"
            >标记已发布</span>
          </div>
        </article>
      </div>
      <EmptyState v-else icon="📦" title="还没有发布包" desc="基于选题生成多平台内容包后，会出现在这里（每平台一张卡）" />
    </template>

    <ItemDetailModal
      v-if="detailItem"
      :item="detailItem"
      @close="detailItem = null"
      @updated="load"
      @deleted="detailItem = null; load()"
      @open-related="openDetail({ id: $event })"
    />
  </div>
</template>

<!-- 流水线步进器样式 + 母子卡 + 卡包 -->
<style scoped>
.content-view { display: flex; flex-direction: column; gap: var(--space-8); }

.content-view__head {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--space-7); padding: var(--space-9) var(--space-11); flex-wrap: wrap;
}
.content-view__head-title { display: flex; align-items: center; gap: var(--space-6); }
.content-view__icon { font-size: 28px; }
.content-view__head-title h1 { font: var(--font-h2); color: var(--text-primary); }
.content-view__sub { font: var(--font-caption); color: var(--text-secondary); margin-top: 2px; }
.content-view__head-stats { display: flex; gap: var(--space-8); font: var(--font-caption); color: var(--text-secondary); }
.content-view__head-stats b { color: var(--line-media); font: var(--font-h3); }

.content-view__create { display: flex; gap: var(--space-4); padding: var(--space-7); }
.content-view__create-input { flex: 1; }

/* ===== 流水线步进器 ===== */
.stepper {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}
.stepper__step {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  padding: 10px 20px;
  font: var(--font-secondary);
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-full);
  backdrop-filter: blur(var(--blur-base));
  -webkit-backdrop-filter: blur(var(--blur-base));
  transition: all var(--transition-fast);
  white-space: nowrap;
}
.stepper__step:hover { color: var(--text-primary); border-color: var(--glass-border-hover); }
.stepper__step.is-active {
  color: var(--text-primary);
  background: var(--glass-bg-strong);
  border-color: color-mix(in srgb, var(--line-media) 45%, transparent);
  box-shadow: 0 2px 12px rgba(234, 88, 12, 0.14), inset 0 1px 0 var(--glass-highlight);
}
.stepper__step.is-active .stepper__count {
  color: var(--line-media);
  background: color-mix(in srgb, var(--line-media) 12%, transparent);
}
.stepper__icon { font-size: 14px; }
.stepper__count {
  padding: 0 8px;
  font: var(--font-micro);
  font-weight: 500;
  color: var(--text-secondary);
  background: rgba(15, 23, 42, 0.06);
  border-radius: var(--radius-full);
}
.stepper__link {
  width: 26px;
  height: 1.5px;
  background: linear-gradient(90deg, var(--glass-border-hover), color-mix(in srgb, var(--line-media) 55%, transparent));
  position: relative;
  flex-shrink: 0;
}
.stepper__link::after {
  content: '';
  position: absolute;
  right: -1px;
  top: 50%;
  width: 7px;
  height: 7px;
  border-top: 1.5px solid color-mix(in srgb, var(--line-media) 55%, transparent);
  border-right: 1.5px solid color-mix(in srgb, var(--line-media) 55%, transparent);
  transform: translateY(-50%) rotate(45deg);
}

/* ===== 选题 / 卡片通用 ===== */
.content-view__grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-7);
}
.content-card { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-8); text-align: left; }
.content-card__role {
  font: var(--font-micro); color: var(--accent-purple); display: flex; align-items: center; gap: var(--space-3);
}
.content-card__title { font: var(--font-h3); color: var(--text-primary); line-height: 1.4; }
.content-card__summary {
  font: var(--font-caption); color: var(--text-secondary); line-height: 1.6;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.content-card__meta { display: flex; align-items: center; justify-content: space-between; margin-top: auto; }
.content-card__badge { font: var(--font-micro); color: var(--text-secondary); }
.content-card__action {
  font: var(--font-micro); color: var(--accent-cyan); cursor: pointer; padding: 2px 8px;
  border: 1px solid rgba(8, 145, 178, 0.35); border-radius: var(--radius-full);
}
.content-card__action:hover { background: rgba(8, 145, 178, 0.12); }

/* ===== 内容工序：母子嵌套卡（外层=来源选题，内嵌工序 Checkbox） ===== */
.content-view__groups { display: flex; flex-direction: column; gap: var(--space-7); }
.content-view__group {
  border-top: 2px solid color-mix(in srgb, var(--line-media) 55%, transparent);
}
.content-view__group-head {
  display: flex; align-items: center; justify-content: space-between;
  font: var(--font-h3); padding: var(--space-7) var(--space-9);
  border-bottom: 1px solid var(--glass-border);
}
.content-view__group-title { color: var(--text-primary); }
.content-view__group-body { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-7); }
.content-view__task {
  display: flex; align-items: center; gap: var(--space-5);
  padding: var(--space-4) var(--space-6); background: var(--glass-bg-faint);
  border: 1px solid transparent; border-radius: var(--radius-sm);
  transition: border-color var(--transition-fast), background var(--transition-fast);
}
.content-view__task:hover { border-color: var(--glass-border); background: var(--glass-hover); }

/* 圆形 Checkbox：hover 泛绿 + 勾 */
.content-view__check {
  width: 20px;
  height: 20px;
  min-width: 20px;
  border-radius: 50%;
  border: 1.5px solid var(--glass-border-hover);
  background: var(--bg-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: transparent;
  transition: all var(--transition-fast);
}
.content-view__check::after { content: '✓'; }
.content-view__check:hover {
  border-color: var(--accent-green);
  color: var(--accent-green);
  background: rgba(5, 150, 105, 0.12);
  box-shadow: 0 0 8px rgba(5, 150, 105, 0.25);
}
.content-view__task-title { flex: 1; font: var(--font-secondary); color: var(--text-primary); }

/* ===== 发布包：Apple Wallet 卡包式 ===== */
.pack {
  position: relative;
  overflow: hidden;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-8);
  text-align: left;
}
.pack__strip {
  height: 4px;
  margin: calc(-1 * var(--space-8)) calc(-1 * var(--space-8)) var(--space-6);
  background: var(--gradient-media);
  opacity: 0.9;
}
.pack--published { opacity: 0.6; }
.pack--published .pack__strip { background: var(--glass-border); }
.pack--published .content-card__title,
.pack--published .content-card__summary { color: var(--text-secondary); }
.pack__role {
  font: var(--font-micro); color: var(--line-media);
  display: flex; align-items: center; gap: var(--space-3);
}
.pack__stamp {
  margin-left: auto;
  font: var(--font-micro);
  font-weight: 700;
  letter-spacing: 1.5px;
  color: var(--accent-green);
  border: 2px solid color-mix(in srgb, var(--accent-green) 55%, transparent);
  background: rgba(5, 150, 105, 0.1);
  padding: 2px 10px;
  border-radius: var(--radius-full);
  transform: rotate(-6deg);
  box-shadow: 0 0 12px rgba(5, 150, 105, 0.2);
}
</style>
