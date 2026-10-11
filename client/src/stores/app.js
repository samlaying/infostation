// ===== 应用全局 store（设置/Agent 状态）=====
import { defineStore } from 'pinia';
import { fetchSettings, updateSettings } from '../api';

export const useAppStore = defineStore('app', {
  state: () => ({
    settings: null,
    loaded: false,
  }),
  getters: {
    agentMode: (s) => s.settings?.agent_mode || 'mock',
    llmConfigured: (s) => Boolean(s.settings?.llm?.configured),
  },
  actions: {
    async load() {
      this.settings = await fetchSettings();
      this.loaded = true;
    },
    async saveGoals(goals) {
      const res = await updateSettings({ user_goals: goals });
      if (this.settings) this.settings.user_goals = res.user_goals;
    },
  },
});
