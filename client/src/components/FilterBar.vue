<script setup>
import { ref, watch } from 'vue';
import { FORM_MAP, PRIORITY_MAP, PLATFORM_MAP } from '../constants';

const props = defineProps({
  filters: { type: Object, required: true },
  searchPlaceholder: { type: String, default: '搜索标题 / 内容 / 标签…' },
});
const emit = defineEmits(['update:filters']);

// 搜索防抖：每个键击都触发 store 重载（API + 全列表重渲染）是输入卡顿的主源
const searchText = ref('');
let debounceTimer = null;
function onSearchInput(e) {
  searchText.value = e.target.value;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    emit('update:filters', { q: searchText.value });
  }, 300);
}

// 外部改 filters.q（如标签云点击）时同步输入框显示
watch(
  () => props.filters.q,
  (v) => {
    if (v !== searchText.value) {
      clearTimeout(debounceTimer);
      searchText.value = v || '';
    }
  }
);

function setFilter(key, value) {
  emit('update:filters', { [key]: value });
}
</script>

<template>
  <div class="filter-bar">
    <div class="filter-bar__row">
      <div class="filter-bar__search">
        <span class="filter-bar__search-icon">🔍</span>
        <input
          class="glass-input filter-bar__input"
          :value="searchText"
          :placeholder="searchPlaceholder"
          @input="onSearchInput"
        />
      </div>
      <select class="glass-select glass-input filter-bar__select" :value="filters.sort" @change="setFilter('sort', $event.target.value)">
        <option value="time">按时间</option>
        <option value="priority">按优先级</option>
        <option value="related">按关联数</option>
      </select>
    </div>

    <div class="filter-bar__chips">
      <span class="filter-bar__group-label">筛选</span>
      <select class="glass-select glass-input filter-bar__select-sm" :value="filters.form" @change="setFilter('form', $event.target.value)">
        <option value="">全部形态</option>
        <option v-for="(f, key) in FORM_MAP" :key="key" :value="key">{{ f.icon }} {{ f.label }}</option>
      </select>
      <select class="glass-select glass-input filter-bar__select-sm" :value="filters.priority" @change="setFilter('priority', $event.target.value)">
        <option value="">全部优先级</option>
        <option v-for="(p, key) in PRIORITY_MAP" :key="key" :value="key">{{ p.label }}优先级</option>
      </select>
      <select class="glass-select glass-input filter-bar__select-sm" :value="filters.platform" @change="setFilter('platform', $event.target.value)">
        <option value="">全部来源</option>
        <option v-for="(p, key) in PLATFORM_MAP" :key="key" :value="key">{{ p }}</option>
      </select>
      <button
        class="filter-chip"
        :class="{ 'is-active': filters.has_todo === 'yes' }"
        @click="setFilter('has_todo', filters.has_todo === 'yes' ? '' : 'yes')"
      >
        ✅ 有 TODO
      </button>
    </div>
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-9);
}

.filter-bar__row {
  display: flex;
  gap: var(--space-4);
}
.filter-bar__search { position: relative; flex: 1; }
.filter-bar__search-icon {
  position: absolute;
  left: var(--space-5);
  top: 50%;
  transform: translateY(-50%);
  font-size: 13px;
  opacity: 0.6;
}
.filter-bar__input { padding-left: 36px; }
.filter-bar__select { width: auto; flex-shrink: 0; }

.filter-bar__chips {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
}
.filter-bar__group-label {
  font: var(--font-micro);
  color: var(--text-muted);
  margin-right: var(--space-2);
  min-width: 30px;
}
.filter-bar__select-sm {
  width: auto;
  padding: 7px 30px 7px var(--space-5);
  font: var(--font-caption);
}

@media (max-width: 768px) {
  .filter-bar__row { flex-direction: column; }
  .filter-bar__select { width: 100%; }
}
</style>
