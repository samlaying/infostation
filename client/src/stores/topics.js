// ===== 主题 store（v2.1）=====
// 长期主题是唯一归属轴（取代 UI 层的旧 category 枚举）。
// 全局缓存一份，SSE topics 变更后由各视图调 refresh()。
import { defineStore } from 'pinia';
import { fetchTopics } from '../api';

export const useTopicsStore = defineStore('topics', {
  state: () => ({
    list: [],
    loading: false,
    loaded: false,
  }),
  getters: {
    active: (s) => s.list.filter((t) => t.status === 'active'),
    byId: (s) => Object.fromEntries(s.list.map((t) => [t.id, t])),
    nameOf() {
      return (id) => (id != null && this.byId[id]?.name) || '';
    },
  },
  actions: {
    async load(force = false) {
      if (this.loaded && !force) return;
      this.loading = true;
      try {
        const res = await fetchTopics();
        this.list = res.topics || [];
        this.loaded = true;
      } finally {
        this.loading = false;
      }
    },
    async refresh() {
      return this.load(true);
    },
  },
});
