<script setup>
import { defineAsyncComponent, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAppStore } from './stores/app';
import { toastState } from './stores/toast';
import BgOrbs from './components/BgOrbs.vue';
import AppToast from './components/AppToast.vue';
import TokenGate from './components/TokenGate.vue';

// shaders 无法 tree-shake（~2.7MB），异步加载以免拖慢首屏；未就绪/不支持时由 BgOrbs 兜底。
// 性能门禁：WebGPU 不存在（如生产 HTTP 非安全上下文）时连 chunk 都不下载，
// 否则生产要白白拉取 2.65MB 只为渲染个空。
const webgpuLikely = typeof navigator !== 'undefined' && !!navigator.gpu;
const ShaderBackground = webgpuLikely
  ? defineAsyncComponent(() => import('./components/ShaderBackground.vue'))
  : null;

const route = useRoute();
const router = useRouter();
const appStore = useAppStore();

// 胶囊导航：路由 meta.group 分三组（核心流 / 复盘流 / 系统），组间渲染玻璃分隔线
const navRoutes = router.options.routes;

onMounted(() => {
  appStore.load().catch(() => {});
});
</script>

<template>
  <div class="app">
    <BgOrbs />
    <ShaderBackground v-if="ShaderBackground" />

    <header class="topbar">
      <div class="pill">
        <RouterLink to="/" class="logo">
          <span class="logo__hex">⬡</span>
          <span class="logo__text">InfoStation</span>
        </RouterLink>

        <span class="pill__divider" aria-hidden="true" />

        <nav class="nav">
          <template v-for="(r, i) in navRoutes" :key="r.name">
            <span
              v-if="i > 0 && r.meta.group !== navRoutes[i - 1].meta.group"
              class="pill__divider"
              aria-hidden="true"
            />
            <RouterLink
              :to="{ name: r.name }"
              class="nav__link"
              :class="{ 'is-active': route.name === r.name }"
            >
              <span class="nav__icon">{{ r.meta.icon }}</span>
              <span class="nav__label">{{ r.meta.title }}</span>
            </RouterLink>
          </template>
        </nav>

        <span class="pill__divider" aria-hidden="true" />

        <span
          v-if="appStore.loaded"
          class="agent-badge"
          :class="{ 'agent-badge--llm': appStore.llmConfigured }"
          :title="appStore.llmConfigured
            ? `私秘 Agent · ${appStore.settings.llm.model}`
            : '规则引擎 Mock 模式（未配置 LLM API Key）'"
        >
          <span class="agent-badge__dot" />
          <span class="agent-badge__text">{{ appStore.llmConfigured ? '私秘 Agent' : 'Mock' }}</span>
        </span>
      </div>
    </header>

    <main class="container main">
      <RouterView v-slot="{ Component }">
        <component :is="Component" :key="$route.fullPath" />
      </RouterView>
    </main>

    <TokenGate />
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

/* ===== 悬浮胶囊顶栏（Floating Glass Pill）===== */
.topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 30;
  display: flex;
  justify-content: center;
  padding: 16px var(--space-11) 0;
  pointer-events: none;
}

.pill {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 6px 12px;
  background: var(--pill-glass);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-full);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  box-shadow: var(--shadow-pill), inset 0 1px 0 var(--glass-highlight);
  max-width: calc(100vw - 32px);
}

.pill__divider {
  width: 1px;
  height: 18px;
  background: var(--glass-border);
  flex-shrink: 0;
}

.logo {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-3);
  flex-shrink: 0;
}
.logo__hex {
  font-size: 22px;
  background: var(--gradient-1);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 10px rgba(59, 130, 246, 0.35));
}
.logo__text {
  font: var(--font-h2);
  font-size: 17px;
  letter-spacing: -0.3px;
  color: var(--text-primary);
}

.nav {
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
}
.nav::-webkit-scrollbar { display: none; }

.nav__link {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 8px 13px;
  font: var(--font-secondary);
  color: var(--text-secondary);
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  transition: all var(--transition-fast);
  white-space: nowrap;
}
.nav__link:hover {
  color: var(--text-primary);
  background: var(--glass-hover);
}
.nav__link.is-active {
  color: var(--text-primary);
  background: var(--glass-bg-strong);
  border-color: var(--glass-border);
  box-shadow: 0 1px 6px rgba(15, 23, 42, 0.08), inset 0 1px 0 var(--glass-highlight);
}

.agent-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  padding: 5px 12px;
  font: var(--font-micro);
  color: var(--text-secondary);
  background: var(--glass-bg-faint);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-full);
  flex-shrink: 0;
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
  padding-top: 100px;
  padding-bottom: var(--space-14);
}

@media (max-width: 900px) {
  .topbar { padding: 12px var(--space-7) 0; }
  .logo__text { display: none; }
  .agent-badge__text { display: none; }
  .agent-badge { padding: 5px 9px; }
  .nav__label { display: none; }
  .nav__link { padding: 8px 11px; }
  .main { padding-top: 84px; }
}
</style>

<!-- 非 scoped：跨子组件匹配。shader 接管背景时让 CSS 光晕彻底退场（隐藏 + 停动画） -->
<style>
.app:has(.shader.is-ready) .bg-orbs {
  visibility: hidden;
}
.app:has(.shader.is-ready) .bg-orb {
  animation-play-state: paused;
}
</style>
