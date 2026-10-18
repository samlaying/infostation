<script setup>
import { ref, computed, watch } from 'vue';
import { useItemsStore } from '../stores/items';
import { useTodosStore } from '../stores/todos';
import {
  CATEGORY_MAP, CONTENT_TYPE_MAP, PRIORITY_MAP, PLATFORM_MAP, LINE_MAP, timeAgo, fmtDate,
} from '../constants';
import { toastError, toastSuccess } from '../stores/toast';

const props = defineProps({
  item: { type: Object, required: true }, // 完整 detail（含 todos / related_items）
});
const emit = defineEmits(['close', 'updated', 'deleted', 'open-related']);

const itemsStore = useItemsStore();
const todosStore = useTodosStore();

const editing = ref(false);
const saving = ref(false);
const form = ref({});

watch(
  () => props.item?.id,
  () => {
    editing.value = false;
    if (props.item) {
      form.value = {
        title: props.item.title,
        summary: props.item.summary,
        primary_category: props.item.primary_category,
        content_type: props.item.content_type,
        priority: props.item.priority,
        line: props.item.line || 'trial',
        tags: (props.item.tags || []).join(', '),
      };
    }
  },
  { immediate: true }
);

const cat = computed(() => CATEGORY_MAP[props.item.primary_category] || CATEGORY_MAP.archive);

async function save() {
  saving.value = true;
  try {
    const body = {
      ...form.value,
      tags: form.value.tags.split(/[,，\s]+/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean),
    };
    const updated = await itemsStore.update(props.item.id, body);
    toastSuccess('已保存');
    editing.value = false;
    emit('updated', updated);
  } catch (e) {
    toastError(e.message);
  } finally {
    saving.value = false;
  }
}

async function remove() {
  if (!confirm(`确定删除「${props.item.title}」及其 TODO？`)) return;
  try {
    await itemsStore.remove(props.item.id);
    toastSuccess('已删除');
    emit('deleted', props.item.id);
  } catch (e) {
    toastError(e.message);
  }
}

async function toggleTodo(t) {
  try {
    await todosStore.update(t.id, { status: t.status === 'done' ? 'pending' : 'done' });
    const local = props.item.todos?.find((x) => x.id === t.id);
    if (local) {
      local.status = local.status === 'done' ? 'pending' : 'done';
      local.completed_at = local.status === 'done' ? new Date().toISOString() : null;
    }
  } catch (e) {
    toastError(e.message);
  }
}

function onKeydown(e) {
  if (e.key === 'Escape') emit('close');
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')" @keydown="onKeydown">
      <div class="modal-box">
        <header class="detail__header">
          <span
            class="detail__cat"
            :style="{
              color: cat.color,
              background: `color-mix(in srgb, ${cat.color} 12%, transparent)`,
              borderColor: `color-mix(in srgb, ${cat.color} 30%, transparent)`,
            }"
          >
            {{ cat.icon }} {{ cat.label }}
          </span>
          <div class="detail__header-actions">
            <span class="priority-dot" :class="`priority-dot--${item.priority}`" :title="`${PRIORITY_MAP[item.priority]?.label}优先级`" />
            <button v-if="!editing" class="btn btn--glass btn--sm" @click="editing = true">✎ 编辑</button>
            <button class="btn btn--danger btn--sm" @click="remove">✕ 删除</button>
            <button class="btn btn--glass btn--sm" @click="emit('close')">关闭</button>
          </div>
        </header>

        <div class="detail__body">
          <template v-if="!editing">
            <h2 class="detail__title">{{ item.title }}</h2>
            <div class="detail__meta">
              <span class="timestamp">🕐 {{ timeAgo(item.created_at) }}</span>
              <span v-if="item.source_platform" class="timestamp">
                {{ PLATFORM_MAP[item.source_platform] || item.source_platform }}
              </span>
              <span v-if="item.source_url" class="detail__link">
                <a :href="item.source_url" target="_blank" rel="noopener">查看原文 ↗</a>
              </span>
              <span class="timestamp">Agent 置信度 {{ Math.round((item.agent_confidence || 0) * 100) }}%</span>
            </div>

            <p class="detail__summary">{{ item.summary }}</p>

            <section v-if="item.key_points?.length" class="detail__section">
              <h3>💡 关键要点</h3>
              <ul>
                <li v-for="(k, i) in item.key_points" :key="i">{{ k }}</li>
              </ul>
            </section>

            <section v-if="item.todos?.length" class="detail__section">
              <h3>📋 提取的 TODO（{{ item.todos.length }}）</h3>
              <div class="detail__todos">
                <div v-for="t in item.todos" :key="t.id" class="detail__todo" @click="toggleTodo(t)">
                  <span class="detail__todo-check" :class="{ 'is-done': t.status === 'done' }">
                    <template v-if="t.status === 'done'">✓</template>
                  </span>
                  <span class="detail__todo-title" :class="{ 'is-done': t.status === 'done' }">{{ t.title }}</span>
                  <span class="timestamp">📅 {{ fmtDate(t.actual_deadline || t.suggested_deadline) }}</span>
                </div>
              </div>
            </section>

            <section v-if="item.related_items?.length" class="detail__section">
              <h3>🔗 关联内容（{{ item.related_items.length }}）</h3>
              <div class="detail__related">
                <button
                  v-for="r in item.related_items"
                  :key="r.id"
                  class="tag-chip"
                  @click="emit('open-related', r.id)"
                >
                  {{ r.title.slice(0, 24) }}
                </button>
              </div>
            </section>

            <section class="detail__section">
              <h3>📄 清洗后全文</h3>
              <p class="detail__content">{{ item.full_content || '（无内容）' }}</p>
            </section>

            <div v-if="item.agent_note" class="detail__note">
              🤖 {{ item.agent_note }}
            </div>
          </template>

          <template v-else>
            <div class="detail__form">
              <label class="form-row">
                <span>标题</span>
                <input v-model="form.title" class="glass-input" />
              </label>
              <label class="form-row">
                <span>摘要</span>
                <textarea v-model="form.summary" class="glass-input" rows="3" />
              </label>
              <div class="form-grid">
                <label class="form-row">
                  <span>产品线</span>
                  <select v-model="form.line" class="glass-select glass-input">
                    <option v-for="(l, key) in LINE_MAP" :key="key" :value="key">{{ l.icon }} {{ l.label }}</option>
                  </select>
                </label>
                <label class="form-row">
                  <span>分类</span>
                  <select v-model="form.primary_category" class="glass-select glass-input">
                    <option v-for="(c, key) in CATEGORY_MAP" :key="key" :value="key">{{ c.icon }} {{ c.label }}</option>
                  </select>
                </label>
                <label class="form-row">
                  <span>内容类型</span>
                  <select v-model="form.content_type" class="glass-select glass-input">
                    <option v-for="(t, key) in CONTENT_TYPE_MAP" :key="key" :value="key">{{ t }}</option>
                  </select>
                </label>
                <label class="form-row">
                  <span>优先级</span>
                  <select v-model="form.priority" class="glass-select glass-input">
                    <option v-for="(p, key) in PRIORITY_MAP" :key="key" :value="key">{{ p.label }}优先级</option>
                  </select>
                </label>
              </div>
              <label class="form-row">
                <span>标签（逗号分隔）</span>
                <input v-model="form.tags" class="glass-input" placeholder="如：小红书运营, 涨粉, 选题" />
              </label>
            </div>
          </template>
        </div>

        <footer v-if="editing" class="detail__footer">
          <button class="btn btn--glass" @click="editing = false">取消</button>
          <button class="btn btn--primary" :disabled="saving" @click="save">
            <span v-if="saving" class="spinner" />
            保存
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.detail__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-5);
  padding: var(--space-9) var(--space-13);
  border-bottom: 1px solid var(--glass-border);
  flex-wrap: wrap;
}

.detail__cat {
  font: var(--font-caption);
  padding: 4px 12px;
  border-radius: var(--radius-full);
  border: 1px solid var(--glass-border);
}
.detail__header-actions { display: flex; align-items: center; gap: var(--space-4); }

.detail__body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-9) var(--space-13);
  display: flex;
  flex-direction: column;
  gap: var(--space-7);
}

.detail__title { font: var(--font-h2); }
.detail__meta { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-6); }

.detail__summary {
  font: var(--font-body);
  color: var(--text-primary);
  line-height: 1.8;
  padding: var(--space-6);
  background: var(--glass-bg-faint);
  border-radius: var(--radius-sm);
}

.detail__section h3 {
  font: var(--font-caption);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-bottom: var(--space-4);
}

.detail__section ul {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.detail__section li {
  font: var(--font-secondary);
  color: var(--text-primary);
  padding-left: var(--space-6);
  position: relative;
}
.detail__section li::before {
  content: '•';
  position: absolute;
  left: 0;
  color: var(--accent-blue);
}

.detail__todos { display: flex; flex-direction: column; gap: var(--space-3); }
.detail__todo {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-6);
  background: var(--glass-bg-faint);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
}
.detail__todo:hover { background: var(--glass-hover); }
.detail__todo-check {
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
.detail__todo-check.is-done { background: var(--accent-green); border-color: var(--accent-green); }
.detail__todo-title { flex: 1; font: var(--font-secondary); }
.detail__todo-title.is-done { text-decoration: line-through; opacity: 0.55; }

.detail__related { display: flex; flex-wrap: wrap; gap: var(--space-3); }

.detail__content {
  font: var(--font-secondary);
  color: var(--text-secondary);
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
  padding: var(--space-6);
  background: var(--glass-bg-faint);
  border-radius: var(--radius-sm);
}

.detail__note {
  font: var(--font-secondary);
  color: var(--accent-cyan);
  padding: var(--space-6);
  background: rgba(6, 182, 212, 0.06);
  border: 1px solid rgba(6, 182, 212, 0.2);
  border-radius: var(--radius-sm);
  line-height: 1.7;
}

.detail__form { display: flex; flex-direction: column; gap: var(--space-6); }
.form-row { display: flex; flex-direction: column; gap: var(--space-3); }
.form-row > span { font: var(--font-caption); color: var(--text-secondary); }
.form-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-5);
}

.detail__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-4);
  padding: var(--space-7) var(--space-13);
  border-top: 1px solid var(--glass-border);
}

@media (max-width: 768px) {
  .form-grid { grid-template-columns: 1fr; }
  .detail__header, .detail__body, .detail__footer { padding-left: var(--space-7); padding-right: var(--space-7); }
}
</style>
