<script setup>
// ===== 主题抽屉（Topic Dock）· v2.0：数据源为后端 topics 表 =====
// 主题是一等公民（跨设备、可挂账、带 last_active 支撑「7 天荒废」提醒）。
// 点击主题 → 按 topic_id 过滤右侧卡片流；新建/删除直接写库。
import { ref, onMounted } from 'vue';
import { fetchTopics, createTopic, deleteTopic } from '../api';
import { toastError } from '../stores/toast';

const props = defineProps({
  active: { type: Number, default: null }, // 当前生效的 topic_id
});
const emit = defineEmits(['select']);

const topics = ref([]);
const loading = ref(true);
const collapsed = ref(false);
const adding = ref(false);
const newTopic = ref('');

async function load() {
  loading.value = true;
  try {
    const res = await fetchTopics();
    topics.value = res.topics || [];
  } catch (e) {
    toastError(e.message);
  } finally {
    loading.value = false;
  }
}

async function addTopic() {
  const name = newTopic.value.trim();
  if (!name) return;
  try {
    await createTopic({ name });
    newTopic.value = '';
    adding.value = false;
    await load();
  } catch (e) {
    toastError(e.message);
  }
}

async function removeTopic(t) {
  if (!confirm(`删除主题「${t.name}」？卡片不会被删，只会解除归属。`)) return;
  try {
    await deleteTopic(t.id);
    if (props.active === t.id) emit('select', null);
    await load();
  } catch (e) {
    toastError(e.message);
  }
}

onMounted(load);
defineExpose({ load });
</script>

<template>
  <aside class="dock glass-panel" :class="{ 'dock--collapsed': collapsed }">
    <header class="dock__head">
      <button class="dock__toggle" :title="collapsed ? '展开主题栏' : '收起主题栏'" @click="collapsed = !collapsed">
        {{ collapsed ? '📦' : '📦 长期主题' }}
      </button>
    </header>

    <nav v-if="!collapsed" class="dock__list">
      <button
        class="dock__item"
        :class="{ 'is-active': active == null }"
        @click="emit('select', null)"
      >
        <span class="dock__icon">🌐</span>
        <span class="dock__name">全部</span>
        <span class="dock__count">{{ loading ? '…' : topics.reduce((a, t) => a + t.item_count, 0) }}</span>
      </button>

      <button
        v-for="t in topics"
        :key="t.id"
        class="dock__item"
        :class="{ 'is-active': active === t.id }"
        :title="`${t.name} · ${t.item_count} 卡 / ${t.todo_count} 任务`"
        @click="emit('select', active === t.id ? null : t.id)"
      >
        <span class="dock__icon">{{ t.icon }}</span>
        <span class="dock__name">{{ t.name }}</span>
        <span class="dock__count">{{ t.item_count }}</span>
        <span class="dock__remove" title="删除主题（卡片保留）" @click.stop="removeTopic(t)">×</span>
      </button>

      <div v-if="adding" class="dock__add">
        <input
          v-model="newTopic"
          class="dock__add-input"
          placeholder="主题名，回车确认"
          autofocus
          @keydown.enter="addTopic"
          @keydown.esc="adding = false; newTopic = ''"
        />
      </div>
      <button v-else class="dock__item dock__item--add" @click="adding = true">
        <span class="dock__icon">＋</span>
        <span class="dock__name">新建主题</span>
      </button>
    </nav>
  </aside>
</template>

<style scoped>
.dock {
  position: sticky;
  top: 96px;
  padding: var(--space-6);
  width: 100%;
}

.dock__head { display: flex; align-items: center; }
.dock__toggle {
  font: var(--font-caption);
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.5px;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
  white-space: nowrap;
}
.dock__toggle:hover { background: var(--glass-hover); color: var(--text-primary); }

.dock__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: var(--space-4);
}

.dock__item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-4);
  font: var(--font-secondary);
  color: var(--text-secondary);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  text-align: left;
  transition: background var(--transition-fast), color var(--transition-fast);
  white-space: nowrap;
}
.dock__item:hover { background: var(--glass-hover); color: var(--text-primary); }
.dock__item.is-active {
  color: var(--text-primary);
  background: var(--glass-bg-strong);
  box-shadow: inset 0 1px 0 var(--glass-highlight);
  border-color: var(--glass-border);
}
.dock__item--add { color: var(--text-muted); }
.dock__item--add:hover { color: var(--accent-blue); }

.dock__icon { font-size: 13px; }
.dock__name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dock__count {
  font: var(--font-micro);
  color: var(--text-secondary);
  background: rgba(15, 23, 42, 0.06);
  padding: 1px 8px;
  border-radius: var(--radius-full);
}
.dock__item.is-active .dock__count {
  color: var(--accent-blue);
  background: rgba(37, 99, 235, 0.1);
}

.dock__remove {
  display: none;
  color: var(--text-muted);
  font-size: 14px;
  padding: 0 2px;
  border-radius: 4px;
}
.dock__remove:hover { color: var(--accent-red); }
.dock__item:hover .dock__remove { display: inline; }

.dock__add { padding: var(--space-2) 0; }
.dock__add-input {
  width: 100%;
  padding: 6px 10px;
  font: var(--font-secondary);
  color: var(--text-primary);
  background: var(--glass-bg-strong);
  border: 1px solid var(--accent-blue);
  border-radius: var(--radius-xs);
  outline: none;
}
</style>
