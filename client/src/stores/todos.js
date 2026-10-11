// ===== TODO store =====
import { defineStore } from 'pinia';
import { fetchTodos, createTodo, patchTodo, deleteTodo } from '../api';

export const useTodosStore = defineStore('todos', {
  state: () => ({
    list: [],
    todaySummary: null,
    loading: false,
  }),
  actions: {
    async load(params = {}) {
      this.loading = true;
      try {
        const res = await fetchTodos(params);
        this.list = res.todos;
        this.todaySummary = res.today_summary;
      } finally {
        this.loading = false;
      }
    },
    async create(body) {
      const t = await createTodo(body);
      this.list.unshift(t);
      return t;
    },
    async update(id, body) {
      const updated = await patchTodo(id, body);
      const i = this.list.findIndex((x) => x.id === id);
      if (i !== -1) this.list[i] = updated;
      return updated;
    },
    async remove(id) {
      await deleteTodo(id);
      this.list = this.list.filter((x) => x.id !== id);
    },
  },
});
