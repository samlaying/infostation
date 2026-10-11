<script setup>
defineProps({
  tags: { type: Array, default: () => [] }, // [{tag, count}]
});
const emit = defineEmits(['select']);

const SIZES = [
  { min: 6, font: 15, color: 'var(--accent-cyan)' },
  { min: 4, font: 14, color: 'var(--accent-purple)' },
  { min: 2, font: 13, color: 'var(--text-primary)' },
  { min: 0, font: 12, color: 'var(--text-secondary)' },
];

function styleFor(count) {
  const s = SIZES.find((x) => count >= x.min);
  return { fontSize: `${s.font}px`, color: s.color };
}
</script>

<template>
  <div v-if="tags.length" class="tag-cloud">
    <button
      v-for="t in tags"
      :key="t.tag"
      class="tag-cloud__item"
      :style="styleFor(t.count)"
      @click="emit('select', t.tag)"
    >
      #{{ t.tag }} <span class="tag-cloud__count">{{ t.count }}</span>
    </button>
  </div>
  <div v-else class="timestamp tag-cloud__empty">暂无标签</div>
</template>

<style scoped>
.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4) var(--space-5);
  align-items: baseline;
}
.tag-cloud__item {
  font-weight: 500;
  transition: all var(--transition-fast);
}
.tag-cloud__item:hover { text-shadow: 0 0 12px rgba(139, 92, 246, 0.5); }
.tag-cloud__count { font-size: 10px; color: var(--text-muted); }
.tag-cloud__empty { padding: var(--space-5); }
</style>
