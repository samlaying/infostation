// ===== 信息（知识卡片）store =====
import { defineStore } from 'pinia';
import { fetchItems, fetchItem, patchItem, deleteItem } from '../api';

export const useItemsStore = defineStore('items', {
  state: () => ({
    list: [],
    total: 0,
    page: 1,
    pageSize: 24,
    loading: false,
    filters: {
      q: '',
      category: '',
      content_type: '',
      priority: '',
      platform: '',
      has_todo: '',
      sort: 'time',
    },
  }),
  actions: {
    async load(page = 1) {
      this.loading = true;
      try {
        const res = await fetchItems({ ...this.filters, page, page_size: this.pageSize });
        this.list = res.items;
        this.total = res.total;
        this.page = res.page;
      } finally {
        this.loading = false;
      }
    },
    async refresh() {
      await this.load(this.page);
    },
    async getDetail(id) {
      return fetchItem(id);
    },
    async update(id, body) {
      const updated = await patchItem(id, body);
      const i = this.list.findIndex((x) => x.id === id);
      if (i !== -1) this.list[i] = { ...this.list[i], ...updated };
      return updated;
    },
    async remove(id) {
      await deleteItem(id);
      this.total -= 1;
      this.list = this.list.filter((x) => x.id !== id);
    },
  },
});
