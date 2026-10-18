<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useItemsStore } from '../stores/items';
import { useTopicsStore } from '../stores/topics';
import FilterBar from '../components/FilterBar.vue';
import ItemCard from '../components/ItemCard.vue';
import ItemInspector from '../components/ItemInspector.vue';
import ItemDetailModal from '../components/ItemDetailModal.vue';
import EmptyState from '../components/EmptyState.vue';
import TopicDock from '../components/TopicDock.vue';
import SegmentTabs from '../components/SegmentTabs.vue';
import { useLiveReload } from '../api/live';

const itemsStore = useItemsStore();
const topicsStore = useTopicsStore();

const detailItem = ref(null);   // Inspector 内容（选中卡片）
const editingItem = ref(null);  // Modal 编辑

// 三态透镜：全部 / 仅看代试 / 仅看内容（化解两条线的“半隔离”观感）
const LENS = [
  { key: '', label: '全部视图', icon: '🌐' },
  { key: 'trial', label: '仅看代试', icon: '⚡' },
  { key: 'media', label: '仅看内容', icon: '✍️' },
];
const lens = computed({
  get: () => itemsStore.filters.line,
  set: (v) => applyFilters({ line: v }),
});

onMounted(async () => {
  await Promise.all([itemsStore.load(1), topicsStore.load(true)]);
});

// SSE：卡片/主题/任务/资产变更后自动刷新（jobs→呼吸灯状态、assets→图数徽章）
useLiveReload(() => { itemsStore.refresh(); topicsStore.refresh(); }, ['items', 'topics', 'jobs', 'assets']);

watch(
  () => itemsStore.filters,
  () => itemsStore.load(1),
  { deep: true }
);

function applyFilters(patch) {
  Object.assign(itemsStore.filters, patch);
}

function onTopicSelect(topicId) {
  applyFilters({ topic_id: topicId ?? '', q: '' }); // 切主题清空关键词，避免过滤打架
}

async function selectItem(item) {
  detailItem.value = await itemsStore.getDetail(item.id);
}

async function selectById(id) {
  detailItem.value = await itemsStore.getDetail(id);
}

function startEdit() {
  if (detailItem.value) editingItem.value = detailItem.value;
}

async function removeItem(item) {
  if (!confirm(`确定删除「${item.title}」及其 TODO？`)) return;
  await itemsStore.remove(item.id);
  if (detailItem.value?.id === item.id) detailItem.value = null;
}

const totalPages = () => Math.max(1, Math.ceil(itemsStore.total / itemsStore.pageSize));
</script>

<template>
  <div class="knowledge" :class="{ 'knowledge--inspecting': !!detailItem }">
    <!-- 左：主题抽屉（长期主题，唯一归属轴） -->
    <TopicDock :active="itemsStore.filters.topic_id ? Number(itemsStore.filters.topic_id) : null" @select="onTopicSelect" />

    <div class="knowledge__main">
      <!-- 三态透镜 -->
      <div class="knowledge__lens">
        <SegmentTabs v-model="lens" :tabs="LENS" />
        <span class="knowledge__lens-count">{{ itemsStore.total }} 张卡片</span>
      </div>

      <FilterBar
        class="glass-panel knowledge__filterbar"
        :filters="itemsStore.filters"
        @update:filters="applyFilters"
      />

      <div v-if="itemsStore.loading && !itemsStore.list.length" class="knowledge__loading">
        <span class="spinner" /> 加载中…
      </div>

      <div v-else-if="itemsStore.list.length" class="knowledge__grid">
        <ItemCard
          v-for="(item, i) in itemsStore.list"
          :key="item.id"
          :item="item"
          :index="i"
          :selected="detailItem?.id === item.id"
          @open="selectItem"
          @delete="removeItem"
        />
      </div>

      <EmptyState
        v-else
        icon="📭"
        title="没有匹配的信息"
        desc="调整筛选条件，或回到工作台录入新信息"
      />

      <div v-if="totalPages() > 1" class="knowledge__pagination">
        <button class="btn btn--glass btn--sm" :disabled="itemsStore.page <= 1" @click="itemsStore.load(itemsStore.page - 1)">← 上一页</button>
        <span class="timestamp">{{ itemsStore.page }} / {{ totalPages() }} 页 · 共 {{ itemsStore.total }} 条</span>
        <button class="btn btn--glass btn--sm" :disabled="itemsStore.page >= totalPages()" @click="itemsStore.load(itemsStore.page + 1)">下一页 →</button>
      </div>
    </div>

    <!-- 右：选中卡片的详情 Inspector（深读 + 资产预览 + 打勾 TODO） -->
    <ItemInspector
      v-if="detailItem"
      class="knowledge__inspector"
      :item="detailItem"
      @close="detailItem = null"
      @edit="startEdit"
      @open-related="selectById"
    />
    <aside v-else class="knowledge__placeholder">
      <div class="glass-panel knowledge__placeholder-card">
        <span class="knowledge__placeholder-icon">🗂</span>
        <p>点击左侧任意卡片<br />在这里深读正文、预览截图、勾掉 TODO</p>
      </div>
    </aside>

    <!-- 编辑仍走 Modal（Inspector 只读 + 勾选） -->
    <ItemDetailModal
      v-if="editingItem"
      :item="editingItem"
      @close="editingItem = null"
      @updated="editingItem = null; if (detailItem) selectById(detailItem.id); itemsStore.refresh()"
      @deleted="editingItem = null; detailItem = null; itemsStore.refresh()"
      @open-related="selectById"
    />
  </div>
</template>

<style scoped>
.knowledge {
  display: grid;
  grid-template-columns: 216px minmax(0, 1fr) 340px;
  gap: var(--space-8);
  align-items: start;
}

.knowledge__main { min-width: 0; }

/* 三态透镜行 */
.knowledge__lens {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-5);
  margin-bottom: var(--space-6);
  flex-wrap: wrap;
}
.knowledge__lens-count { font: var(--font-caption); color: var(--text-muted); }

.knowledge__filterbar { margin-bottom: var(--space-8); }

.knowledge__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--space-8);
}

.knowledge__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  padding: var(--space-14);
  color: var(--text-secondary);
  font: var(--font-secondary);
}

.knowledge__pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-7);
  margin-top: var(--space-9);
}

.knowledge__inspector { grid-column: 3; grid-row: 1; }

.knowledge__placeholder {
  grid-column: 3;
  grid-row: 1;
  position: sticky;
  top: 88px;
}
.knowledge__placeholder-card {
  padding: var(--space-14) var(--space-9);
  text-align: center;
  color: var(--text-muted);
  font: var(--font-secondary);
  line-height: 1.8;
  border-style: dashed;
}
.knowledge__placeholder-icon { font-size: 30px; display: block; margin-bottom: var(--space-5); opacity: 0.7; }

@media (max-width: 1280px) {
  .knowledge { grid-template-columns: minmax(0, 1fr) 340px; }
  .knowledge > :first-child { display: none; } /* 窄屏收起主题抽屉 */
}
@media (max-width: 1024px) {
  .knowledge { grid-template-columns: 1fr; }
  .knowledge__inspector, .knowledge__placeholder {
    grid-column: 1;
    grid-row: auto;
    position: static;
    order: 5;
  }
}
</style>
