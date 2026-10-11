import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  {
    path: '/',
    name: 'dashboard',
    component: () => import('../views/DashboardView.vue'),
    meta: { title: '工作台', icon: '🏠' },
  },
  {
    path: '/knowledge',
    name: 'knowledge',
    component: () => import('../views/KnowledgeView.vue'),
    meta: { title: '信息库', icon: '📥' },
  },
  {
    path: '/todos',
    name: 'todos',
    component: () => import('../views/TodosView.vue'),
    meta: { title: 'TODO 面板', icon: '✅' },
  },
  {
    path: '/analytics',
    name: 'analytics',
    component: () => import('../views/AnalyticsView.vue'),
    meta: { title: '数据看板', icon: '📊' },
  },
  {
    path: '/weekly',
    name: 'weekly',
    component: () => import('../views/WeeklyView.vue'),
    meta: { title: '周报', icon: '📋' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../views/SettingsView.vue'),
    meta: { title: '设置', icon: '⚙️' },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.afterEach((to) => {
  document.title = `${to.meta.title} · InfoStation`;
});
