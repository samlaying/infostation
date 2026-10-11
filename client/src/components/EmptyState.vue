<script setup>
defineProps({
  icon: { type: String, default: '📭' },
  title: { type: String, required: true },
  desc: { type: String, default: '' },
});
</script>

<template>
  <div class="empty-state">
    <div class="empty-state__icon">{{ icon }}</div>
    <div class="empty-state__title">{{ title }}</div>
    <div v-if="desc" class="empty-state__desc">{{ desc }}</div>
    <slot />
  </div>
</template>
