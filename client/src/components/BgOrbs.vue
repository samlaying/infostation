<script setup>
// 三光晕球体背景（guide.md 6.1/6.2：蓝右上 / 紫左下 / 青中央，呼吸动画）
// 性能：不用 filter: blur(80px)（大面积高斯模糊每帧重算，是背景动画卡的来源），
// 改用径向渐变直接画出"已模糊"的光斑——视觉一致，滤镜成本归零。
</script>

<template>
  <div class="bg-orbs" aria-hidden="true">
    <div class="bg-orb bg-orb--1" />
    <div class="bg-orb bg-orb--2" />
    <div class="bg-orb bg-orb--3" />
  </div>
</template>

<style scoped>
.bg-orbs {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}

.bg-orb {
  position: absolute;
  border-radius: 50%;
  animation: orbBreath 4s ease-in-out infinite;
  will-change: opacity;
}

.bg-orb--1 {
  --orb-opacity: 0.16;
  width: 620px;
  height: 620px;
  top: -210px;
  right: -110px;
  background: radial-gradient(circle at 50% 50%,
    rgba(59, 130, 246, 0.55) 0%,
    rgba(59, 130, 246, 0.28) 34%,
    rgba(59, 130, 246, 0.10) 58%,
    transparent 72%);
}

.bg-orb--2 {
  --orb-opacity: 0.16;
  width: 520px;
  height: 520px;
  bottom: -160px;
  left: -160px;
  background: radial-gradient(circle at 50% 50%,
    rgba(139, 92, 246, 0.5) 0%,
    rgba(139, 92, 246, 0.24) 34%,
    rgba(139, 92, 246, 0.09) 58%,
    transparent 72%);
  animation-delay: 1.2s;
}

.bg-orb--3 {
  --orb-opacity: 0.09;
  width: 420px;
  height: 420px;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle at 50% 50%,
    rgba(6, 182, 212, 0.45) 0%,
    rgba(6, 182, 212, 0.2) 34%,
    rgba(6, 182, 212, 0.07) 58%,
    transparent 72%);
  animation-delay: 2.4s;
}
</style>
