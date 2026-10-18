<script setup>
// ===== 卡片 Inspector（信息库右侧详情抽屉）· v2.1 =====
// 取代信息库右侧的统计侧栏（分类分布/标签云归数据看板管，MECE）。
// 职责：深读选中卡片 —— 正文、Agent 截图/生图资产、名下 TODO 直接打勾、关联跳转。
import { computed } from 'vue';
import { useTodosStore } from '../stores/todos';
import { PLATFORM_MAP, PRIORITY_MAP, FORM_MAP, itemForm, timeAgo, fmtDate } from '../constants';
import { toastError, toastSuccess } from '../stores/toast';

const props = defineProps({
  item: { type: Object, required: true }, // 完整 detail（含 todos / assets / related_items）
});
const emit = defineEmits(['close', 'edit', 'open-related']);

const todosStore = useTodosStore();
const form = computed(() => itemForm(props.item));

async function toggleTodo(t) {
  try {
    const next = t.status === 'done' ? 'pending' : 'done';
    await todosStore.update(t.id, { status: next });
    t.status = next;
    t.completed_at = next === 'done' ? new Date().toISOString() : null;
    if (next === 'done') toastSuccess('已完成 ✓');
  } catch (e) {
    toastError(e.message);
  }
}

/** 可预览的资产：有远程 URL 的直接出图；本地路径的给占位（由本地 Agent 上传图床后回填 --url） */
const previewAssets = computed(() => (props.item.assets || []).filter((a) => a.remote_url));
</script>

<template>
  <aside class="inspector glass-panel">
    <header class="inspector__header">
      <div class="inspector__header-tags">
        <span class="inspector__form">{{ FORM_MAP[form].icon }} {{ FORM_MAP[form].label }}</span>
        <span v-if="item.topic_name" class="inspector__topic">📁 {{ item.topic_name }}</span>
      </div>
      <div class="inspector__header-actions">
        <button class="btn btn--glass btn--sm" @click="emit('edit')">✎ 编辑</button>
        <button class="btn btn--glass btn--sm" @click="emit('close')">收起 ✕</button>
      </div>
    </header>

    <div class="inspector__body">
      <h2 class="inspector__title">{{ item.title }}</h2>
      <div class="inspector__meta">
        <span class="timestamp">🕐 {{ timeAgo(item.created_at) }}</span>
        <span v-if="item.source_platform && item.source_platform !== 'manual'" class="timestamp">
          {{ PLATFORM_MAP[item.source_platform] || item.source_platform }}
        </span>
        <a v-if="item.source_url" class="inspector__link" :href="item.source_url" target="_blank" rel="noopener">
          查看原文 ↗
        </a>
        <span class="timestamp">Agent 置信度 {{ Math.round((item.agent_confidence || 0) * 100) }}%</span>
      </div>

      <p class="inspector__summary">{{ item.summary }}</p>

      <!-- Agent 视觉资产：截图 / 生图 / 图床 -->
      <section v-if="item.assets?.length" class="inspector__section">
        <h3>🖼 视觉资产（{{ item.assets.length }}）</h3>
        <div class="inspector__assets">
          <a
            v-for="a in previewAssets"
            :key="a.id"
            class="inspector__asset"
            :href="a.remote_url"
            target="_blank"
            rel="noopener"
            :title="`${a.asset_type}${a.prompt ? ' · ' + a.prompt : ''}`"
          >
            <img :src="a.remote_url" loading="lazy" alt="" />
          </a>
          <div
            v-for="a in (item.assets || []).filter((x) => !x.remote_url)"
            :key="`local-${a.id}`"
            class="inspector__asset inspector__asset--local"
            :title="a.local_path"
          >
            📎 {{ a.asset_type === 'screenshot' ? '截图' : a.asset_type === 'ai_image' ? '生图' : '文件' }}（待上传图床）
          </div>
        </div>
      </section>

      <section v-if="item.key_points?.length" class="inspector__section">
        <h3>💡 关键要点</h3>
        <ul class="inspector__points">
          <li v-for="(k, i) in item.key_points" :key="i">{{ k }}</li>
        </ul>
      </section>

      <section v-if="item.todos?.length" class="inspector__section">
        <h3>📋 TODO（{{ item.todos.filter((t) => t.status === 'done').length }}/{{ item.todos.length }}）</h3>
        <div class="inspector__todos">
          <div v-for="t in item.todos" :key="t.id" class="inspector__todo" @click="toggleTodo(t)">
            <span class="inspector__todo-check" :class="{ 'is-done': t.status === 'done' }">
              <template v-if="t.status === 'done'">✓</template>
            </span>
            <span class="inspector__todo-title" :class="{ 'is-done': t.status === 'done' }">{{ t.title }}</span>
            <span class="priority-dot" :class="`priority-dot--${t.priority}`" :title="`${PRIORITY_MAP[t.priority]?.label}优先级`" />
            <span class="timestamp">📅 {{ fmtDate(t.actual_deadline || t.suggested_deadline) }}</span>
          </div>
        </div>
      </section>

      <section v-if="item.related_items?.length" class="inspector__section">
        <h3>🔗 关联内容（{{ item.related_items.length }}）</h3>
        <div class="inspector__related">
          <button v-for="r in item.related_items" :key="r.id" class="tag-chip" @click="emit('open-related', r.id)">
            {{ r.title.slice(0, 24) }}
          </button>
        </div>
      </section>

      <section class="inspector__section">
        <h3>📄 清洗后全文</h3>
        <p class="inspector__content">{{ item.full_content || '（无内容）' }}</p>
      </section>

      <div v-if="item.agent_note" class="inspector__note">🤖 {{ item.agent_note }}</div>
    </div>
  </aside>
</template>

<style scoped>
.inspector {
  position: sticky;
  top: 88px;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 108px);
  overflow: hidden;
}

.inspector__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-7) var(--space-9);
  border-bottom: 1px solid var(--glass-border);
  flex-wrap: wrap;
}
.inspector__header-tags { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.inspector__form, .inspector__topic {
  font: var(--font-caption);
  padding: 3px 10px;
  border-radius: var(--radius-full);
  border: 1px solid var(--glass-border);
}
.inspector__topic { color: var(--accent-blue); border-color: rgba(37, 99, 235, 0.3); background: rgba(37, 99, 235, 0.07); }
.inspector__header-actions { display: flex; gap: var(--space-3); }

.inspector__body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-8) var(--space-9);
  display: flex;
  flex-direction: column;
  gap: var(--space-7);
}

.inspector__title { font: var(--font-h2); line-height: 1.4; }
.inspector__meta { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-5); }
.inspector__link { font: var(--font-caption); color: var(--accent-cyan); text-decoration: none; }
.inspector__link:hover { text-decoration: underline; }

.inspector__summary {
  font: var(--font-secondary);
  color: var(--text-primary);
  line-height: 1.8;
  padding: var(--space-6);
  background: var(--glass-bg-faint);
  border-radius: var(--radius-sm);
}

.inspector__section h3 {
  font: var(--font-caption);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-bottom: var(--space-4);
}

.inspector__assets { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: var(--space-4); }
.inspector__asset {
  aspect-ratio: 3 / 2;
  border-radius: var(--radius-sm);
  overflow: hidden;
  border: 1px solid var(--glass-border);
  display: flex;
  align-items: center;
  justify-content: center;
}
.inspector__asset img { width: 100%; height: 100%; object-fit: cover; }
.inspector__asset--local {
  font: var(--font-micro);
  color: var(--text-secondary);
  padding: var(--space-3);
  text-align: center;
  border-style: dashed;
}

.inspector__points {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.inspector__points li {
  font: var(--font-secondary);
  color: var(--text-primary);
  line-height: 1.6;
  padding: var(--space-3) var(--space-5);
  background: var(--glass-bg-faint);
  border-radius: var(--radius-sm);
}

.inspector__todos { display: flex; flex-direction: column; gap: var(--space-3); }
.inspector__todo {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  background: var(--glass-bg-faint);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
}
.inspector__todo:hover { background: var(--glass-hover); }
.inspector__todo-check {
  width: 18px;
  height: 18px;
  min-width: 18px;
  border: 1.5px solid var(--glass-border-hover);
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #fff;
}
.inspector__todo-check.is-done { background: var(--accent-green); border-color: var(--accent-green); }
.inspector__todo-title { flex: 1; font: var(--font-secondary); }
.inspector__todo-title.is-done { text-decoration: line-through; opacity: 0.55; }

.inspector__related { display: flex; flex-wrap: wrap; gap: var(--space-3); }

.inspector__content {
  font: var(--font-secondary);
  color: var(--text-secondary);
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow-y: auto;
  padding: var(--space-6);
  background: var(--glass-bg-faint);
  border-radius: var(--radius-sm);
}

.inspector__note {
  font: var(--font-secondary);
  color: var(--accent-cyan);
  padding: var(--space-6);
  background: rgba(6, 182, 212, 0.06);
  border: 1px solid rgba(6, 182, 212, 0.2);
  border-radius: var(--radius-sm);
  line-height: 1.7;
  white-space: pre-wrap;
}
</style>
