<script setup>
// WebGPU 动态背景（shaders@4）· 亮色基调：白画布 + 业务线语义弥散光
// - 代试/行动线页面（默认）：冷调 天蓝→靛紫→青（专注、执行）
// - 内容生产页（/content）：暖调 珊瑚橙→琥珀金→粉（灵感、创作）
// 取色自 tokens.css 的 --line-* 语义组；WebGPU 不可用时静默退场，由 BgOrbs 兜底
//
// 注意：shaders 的 core/index.js 用 200 条裸副作用导入注册全部 204 个组件，
// 无法 tree-shake，任何入口都至少 ~2.7MB。因此本组件由 App.vue 异步加载（defineAsyncComponent）。
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Shader, SolidColor, MeshGradient, Aurora, Vignette, FilmGrain, isWebGPUSupported } from 'shaders/vue';

const route = useRoute();

const supported = ref(typeof navigator !== 'undefined' && isWebGPUSupported());
const failed = ref(false);
const ready = ref(false);
const shaderRef = ref(null);

const reducedMotion = ref(
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
);

const enabled = computed(() => supported.value && !failed.value);

// 性能：就绪后降采样 + 封帧。弥散背景本就是糊的，0.7 倍分辨率视觉无差、
// 填充成本降一半；30fps 对环境光足够（人眼对慢速弥散不敏感）。
function onReady() {
  ready.value = true;
  try {
    shaderRef.value?.setResolutionScale?.(0.7);
    shaderRef.value?.setFrameRateCap?.(30);
  } catch { /* 暴露方法缺失时静默跳过 */ }
}

// 环境光语义：内容生产页暖调，其余冷调
const isMedia = computed(() => route.path.startsWith('/content'));

const auroraColors = computed(() =>
  isMedia.value
    ? { a: '#fb923c', b: '#fbbf24', c: '#f472b6' } // 珊瑚橙 / 琥珀金 / 粉
    : { a: '#8b5cf6', b: '#3b82f6', c: '#06b6d4' } // 靛紫 / 蓝 / 青
);

const meshStops = computed(() =>
  isMedia.value
    ? [
        { color: '#fff7ed', position: 0 },
        { color: '#ffedd5', position: 0.34 },
        { color: '#fce7f3', position: 0.62 },
        { color: '#f8fafc', position: 1 },
      ]
    : [
        { color: '#f0f6ff', position: 0 },
        { color: '#e0ecff', position: 0.34 },
        { color: '#ede9fe', position: 0.62 },
        { color: '#f8fafc', position: 1 },
      ]
);

function onUnavailable(reason) {
  // 无适配器 / 设备丢失等：永久降级，不再重试
  failed.value = true;
  if (import.meta.env.DEV) console.warn('[ShaderBackground] WebGPU 不可用，降级 CSS 背景：', reason);
}
</script>

<template>
  <Shader
    v-if="enabled"
    ref="shaderRef"
    class="shader-bg"
    :class="{ 'is-ready': ready }"
    :disable-telemetry="true"
    aria-hidden="true"
    @ready="onReady"
    @unavailable="onUnavailable"
  >
    <!-- 基底：白画布，与 body 背景一致 -->
    <SolidColor color="#f8fafc" />

    <!-- 全屏弥散光：业务线语义的浅色 mesh，缓慢漂移 -->
    <MeshGradient
      :stops="meshStops"
      color-space="oklab"
      :count="5"
      :smoothness="2"
      :variation="0.35"
      :swirl="0.25"
      :drift="0.4"
      :speed="reducedMotion ? 0 : 0.5"
      :opacity="0.9"
    />

    <!-- 焦点辉光：极光，颜色随业务线切换 -->
    <Aurora
      :color-a="auroraColors.a"
      :color-b="auroraColors.b"
      :color-c="auroraColors.c"
      :center="{ x: 0.5, y: -0.05 }"
      :intensity="45"
      :balance="45"
      :waviness="65"
      :ray-density="12"
      :height="165"
      :curtain-count="3"
      :speed="reducedMotion ? 0 : 1.4"
      :opacity="0.32"
    />

    <!-- 边缘收拢：亮色下用极浅灰替代暗角，保持通透 -->
    <Vignette color="#e2e8f0" :radius="0.5" :falloff="0.75" :intensity="0.55" />

    <!-- 质感：静态颗粒（animated 会逐帧重算纹理，静态视觉几乎无差） -->
    <FilmGrain :strength="0.1" :bias="2" :animated="false" :opacity="0.22" />
  </Shader>
</template>

<style scoped>
.shader-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  opacity: 0;
  transition: opacity 1.2s ease;
}
.shader-bg.is-ready {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .shader-bg { transition: none; }
}
</style>
