<script setup>
// 三光晕球体背景（guide.md 6.1/6.2：蓝右上 / 紫左下 / 青中央，2s 呼吸）
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
  filter: blur(var(--blur-orb));
  animation: orbBreath 4s ease-in-out infinite;
}

.bg-orb--1 {
  --orb-opacity: 0.15;
  width: 600px;
  height: 600px;
  background: var(--accent-blue);
  top: -200px;
  right: -100px;
}

.bg-orb--2 {
  --orb-opacity: 0.15;
  width: 500px;
  height: 500px;
  background: var(--accent-purple);
  bottom: -150px;
  left: -150px;
  animation-delay: 1.2s;
}

.bg-orb--3 {
  --orb-opacity: 0.08;
  width: 400px;
  height: 400px;
  background: var(--accent-cyan);
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  animation-delay: 2.4s;
}
</style>
