<script setup>
import { ref, watch, onMounted } from 'vue';
import { useItemsStore } from '../stores/items';
import { useStatsStore } from '../stores/stats';
import { api } from '../api';
import FilterBar from '../components/FilterBar.vue';
import ItemCard from '../components/ItemCard.vue';
import ItemDetailModal from '../components/ItemDetailModal.vue';
import EmptyState from '../components/EmptyState.vue';
import CategoryBars from '../components/CategoryBars.vue';
import TagCloud from '../components/TagCloud.vue';

const itemsStore = useItemsStore();
const statsStore = useStatsStore();

const detailItem = ref(null);
const pagination = ref({ page: 1 });

onMounted(async () => {
  await Promise.all([itemsStore.load(1), statsStore.load()]);
});

watch(
  () => itemsStore.filters,
  () => itemsStore.load(1),
  { deep: true }
);

function applyFilters(patch) {
  Object.assign(itemsStore.filters, patch);
}

async function openDetail(item) {
  detailItem.value = await itemsStore.getDetail(item.id);
}

async function removeItem(item) {
  if (!confirm(`确定删除「${item.title}」及其 TODO？`)) return;
  await itemsStore.remove(item.id);
}

const totalPages = () => Math.max(1, Math.ceil(itemsStore.total / itemsStore.pageSize));
</script>

<template>
  <div class="knowledge">
    <div class="knowledge__main">
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
          @open="openDetail"
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

    <!-- 侧边栏（guide.md 10.4：340px sticky） -->
    <aside class="knowledge__sidebar">
      <section class="glass-panel knowledge__side-card">
        <h2 class="knowledge__side-title">📊 分类分布</h2>
        <CategoryBars :data="statsStore.data?.category_distribution || []" mode="category" />
      </section>

      <section class="glass-panel knowledge__side-card">
        <h2 class="knowledge__side-title">🏷 标签云</h2>
        <TagCloud :tags="statsStore.data?.top_tags || []" @select="(t) => applyFilters({ q: t })" />
      </section>

      <section class="glass-panel knowledge__side-card">
        <h2 class="knowledge__side-title">🕐 最近活动</h2>
        <div v-if="itemsStore.list.length" class="knowledge__activity">
          <div v-for="it in itemsStore.list.slice(0, 6)" :key="it.id" class="knowledge__activity-row">
            <span class="knowledge__activity-icon">＋</span>
            <span class="knowledge__activity-text">处理了「{{ it.title.slice(0, 16) }}」</span>
            <span class="timestamp">{{ it.created_at.slice(5, 10) }}</span>
          </div>
        </div>
        <div v-else class="timestamp">暂无活动</div>
      </section>
    </aside>

    <ItemDetailModal
      v-if="detailItem"
      :item="detailItem"
      @close="detailItem = null"
      @updated="itemsStore.refresh(); statsStore.load()"
      @deleted="detailItem = null; itemsStore.refresh(); statsStore.load()"
      @open-related="openDetail({ id: $event })"
    />
  </div>
</template>

<style scoped>
.knowledge {
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: var(--space-9);
  align-items: start;
}

.knowledge__main { min-width: 0; }
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

.knowledge__sidebar {
  position: sticky;
  top: 88px;
  display: flex;
  flex-direction: column;
  gap: var(--space-9);
}

.knowledge__side-card { padding: var(--space-9); }
.knowledge__side-title {
  font: var(--font-h3);
  margin-bottom: var(--space-7);
}

.knowledge__activity { display: flex; flex-direction: column; gap: var(--space-4); }
.knowledge__activity-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  font: var(--font-micro);
}
.knowledge__activity-icon { color: var(--accent-green); }
.knowledge__activity-text {
  flex: 1;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 1024px) {
  .knowledge { grid-template-columns: 1fr; }
  .knowledge__sidebar { position: static; order: -1; }
}
</style>
