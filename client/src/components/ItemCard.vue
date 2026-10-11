<script setup>
import { computed } from 'vue';
import { CATEGORY_MAP, CONTENT_TYPE_MAP, PRIORITY_MAP, PLATFORM_MAP, timeAgo } from '../constants';

const props = defineProps({
  item: { type: Object, required: true },
  index: { type: Number, default: 0 },
});

const emit = defineEmits(['open', 'edit', 'delete']);

const cat = computed(() => CATEGORY_MAP[props.item.primary_category] || CATEGORY_MAP.archive);
const todoCount = computed(() => props.item.todo_count ?? 0);
</script>

<template>
  <article
    class="item-card glass-card glass-card--hover fade-in"
    :style="{ '--delay': `${Math.min(index, 12) * 60}ms` }"
    @click="emit('open', item)"
  >
    <header class="item-card__header">
      <span
        class="item-card__cat"
        :style="{
          color: cat.color,
          background: `color-mix(in srgb, ${cat.color} 12%, transparent)`,
          borderColor: `color-mix(in srgb, ${cat.color} 30%, transparent)`,
        }"
      >
        {{ cat.icon }} {{ cat.label }}
      </span>
      <div class="item-card__header-right">
        <span v-if="item.agent_confidence < 0.7" class="item-card__lowconf" title="Agent 置信度较低">?</span>
        <span class="priority-dot" :class="`priority-dot--${item.priority}`" :title="`${PRIORITY_MAP[item.priority]?.label}优先级`" />
      </div>
    </header>

    <h3 class="item-card__title">{{ item.title }}</h3>

    <p class="item-card__summary clamp-4">{{ item.summary }}</p>

    <div v-if="item.tags?.length" class="item-card__tags">
      <span v-for="t in item.tags.slice(0, 4)" :key="t" class="tag-chip" @click.stop>#{{ t }}</span>
    </div>

    <footer class="item-card__footer">
      <div class="item-card__meta">
        <span class="timestamp">🕐 {{ timeAgo(item.created_at) }}</span>
        <span v-if="item.source_platform && item.source_platform !== 'manual'" class="timestamp">
          {{ PLATFORM_MAP[item.source_platform] || item.source_platform }}
        </span>
      </div>
      <div class="item-card__badges">
        <span v-if="todoCount" class="item-card__badge item-card__badge--todo">✅ {{ todoCount }}</span>
        <span v-if="item.related_count" class="item-card__badge">🔗 {{ item.related_count }}</span>
        <span class="item-card__badge">{{ CONTENT_TYPE_MAP[item.content_type] || item.content_type }}</span>
        <button class="icon-btn" title="删除" @click.stop="emit('delete', item)">✕</button>
      </div>
    </footer>
  </article>
</template>

<style scoped>
.item-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-11);
  cursor: pointer;
}

.item-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.item-card__cat {
  font: var(--font-micro);
  padding: 3px 10px;
  border-radius: var(--radius-full);
  border: 1px solid var(--glass-border);
}

.item-card__header-right { display: flex; align-items: center; gap: var(--space-4); }
.item-card__lowconf {
  font: var(--font-micro);
  color: var(--accent-orange);
  border: 1px solid var(--accent-orange);
  border-radius: 50%;
  width: 15px;
  height: 15px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.item-card__title {
  font: var(--font-h3);
  color: var(--text-primary);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.item-card__summary {
  font: var(--font-secondary);
  color: var(--text-secondary);
  flex: 1;
}

.item-card__tags { display: flex; flex-wrap: wrap; gap: var(--space-2); }

.item-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding-top: var(--space-5);
  border-top: 1px solid var(--glass-border);
  margin-top: var(--space-2);
}

.item-card__meta { display: flex; gap: var(--space-4); }
.item-card__badges { display: flex; align-items: center; gap: var(--space-3); }

.item-card__badge {
  font: var(--font-micro);
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  padding: 2px 8px;
  border-radius: var(--radius-full);
}
.item-card__badge--todo { color: var(--accent-green); }

.icon-btn {
  padding: 4px;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  font-size: 12px;
  transition: all var(--transition-fast);
}
.icon-btn:hover { color: var(--accent-red); background: var(--glass-hover); }
</style>
