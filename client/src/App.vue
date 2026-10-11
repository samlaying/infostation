<script setup>
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from './stores/app';
import { toastState } from './stores/toast';
import BgOrbs from './components/BgOrbs.vue';
import AppToast from './components/AppToast.vue';

const router = useRouter();
const appStore = useAppStore();

onMounted(() => {
  appStore.load().catch(() => {});
});
</script>

<template>
  <div class="app">
    <BgOrbs />

    <header class="topbar">
      <div class="topbar__inner container">
        <RouterLink to="/" class="logo">
          <span class="logo__hex">⬡</span>
          <span class="logo__text">InfoStation</span>
        </RouterLink>

        <nav class="nav">
          <RouterLink
            v-for="r in router.options.routes"
            :key="r.name"
            :to="{ name: r.name }"
            class="nav__link"
            :class="{ 'is-active': $route.name === r.name }"
          >
            <span class="nav__icon">{{ r.meta.icon }}</span>
            <span class="nav__label">{{ r.meta.title }}</span>
          </RouterLink>
        </nav>

        <div class="topbar__right">
          <span
            v-if="appStore.loaded"
            class="agent-badge"
            :class="{ 'agent-badge--llm': appStore.llmConfigured }"
            :title="appStore.llmConfigured
              ? `私秘 Agent · ${appStore.settings.llm.model}`
              : '规则引擎 Mock 模式（未配置 LLM API Key）'"
          >
            <span class="agent-badge__dot" />
            {{ appStore.llmConfigured ? '私秘 Agent' : 'Mock 模式' }}
          </span>
        </div>
      </div>
    </header>

    <main class="container main">
      <RouterView v-slot="{ Component }">
        <component :is="Component" :key="$route.fullPath" />
      </RouterView>
    </main>

    <AppToast :toasts="toastState.toasts" />
  </div>
</template>

<style scoped>
.app {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  background: rgba(10, 14, 26, 0.75);
  backdrop-filter: blur(var(--blur-heavy));
  -webkit-backdrop-filter: blur(var(--blur-heavy));
  border-bottom: 1px solid var(--glass-border);
}

.topbar__inner {
  display: flex;
  align-items: center;
  gap: var(--space-9);
  height: 64px;
}

.logo {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-shrink: 0;
}
.logo__hex {
  font-size: 26px;
  background: var(--gradient-1);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 12px rgba(59, 130, 246, 0.4));
}
.logo__text {
  font: var(--font-h1);
  font-size: 20px;
  letter-spacing: -0.5px;
  background: var(--gradient-1);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.nav {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 1;
  overflow-x: auto;
  scrollbar-width: none;
}
.nav::-webkit-scrollbar { display: none; }

.nav__link {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 8px 14px;
  font: var(--font-secondary);
  color: var(--text-secondary);
  border-radius: var(--radius-full);
  transition: all var(--transition-base);
  white-space: nowrap;
}
.nav__link:hover {
  color: var(--text-primary);
  background: var(--glass-hover);
}
.nav__link.is-active {
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}

.topbar__right { flex-shrink: 0; }

.agent-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  padding: 5px 12px;
  font: var(--font-micro);
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-full);
}
.agent-badge--llm { color: var(--accent-cyan); }
.agent-badge__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-orange);
  box-shadow: 0 0 8px var(--accent-orange);
}
.agent-badge--llm .agent-badge__dot {
  background: var(--accent-cyan);
  box-shadow: 0 0 8px var(--accent-cyan);
}

.main {
  flex: 1;
  padding-top: var(--space-9);
  padding-bottom: var(--space-14);
}

@media (max-width: 768px) {
  .topbar__inner { height: 56px; gap: var(--space-5); }
  .logo__text { display: none; }
  .nav__label { display: none; }
  .nav__link { padding: 8px 10px; }
  .agent-badge { display: none; }
}
</style>
