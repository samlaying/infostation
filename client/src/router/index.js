import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  {
    path: '/',
    name: 'dashboard',
    component: () => import('../views/DashboardView.vue'),
    meta: { title: '工作台', icon: '🏠', group: 'core' },
  },
  {
    path: '/knowledge',
    name: 'knowledge',
    component: () => import('../views/KnowledgeView.vue'),
    meta: { title: '信息库', icon: '📥', group: 'core' },
  },
  {
    path: '/todos',
    name: 'todos',
    component: () => import('../views/TodosView.vue'),
    meta: { title: 'TODO 面板', icon: '✅', group: 'core' },
  },
  {
    path: '/content',
    name: 'content',
    component: () => import('../views/ContentProductionView.vue'),
    meta: { title: '内容生产', icon: '✍️', group: 'core' },
  },
  {
    path: '/push',
    name: 'push',
    component: () => import('../views/PushView.vue'),
    meta: { title: '主动推动', icon: '🧭', group: 'core' },
  },
  {
    path: '/analytics',
    name: 'analytics',
    component: () => import('../views/AnalyticsView.vue'),
    meta: { title: '数据看板', icon: '📊', group: 'review' },
  },
  {
    path: '/weekly',
    name: 'weekly',
    component: () => import('../views/WeeklyView.vue'),
    meta: { title: '周报', icon: '📋', group: 'review' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../views/SettingsView.vue'),
    meta: { title: '设置', icon: '⚙️', group: 'system' },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.afterEach((to) => {
  document.title = `${to.meta.title} · InfoStation`;
});
