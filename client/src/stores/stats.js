// ===== 数据看板 store =====
import { defineStore } from 'pinia';
import { fetchStats } from '../api';

export const useStatsStore = defineStore('stats', {
  state: () => ({
    data: null,
    loading: false,
  }),
  actions: {
    async load() {
      this.loading = true;
      try {
        this.data = await fetchStats();
      } finally {
        this.loading = false;
      }
    },
  },
});
