<script setup>
import { ref, computed } from 'vue';
import { processInput } from '../api';
import { CATEGORY_MAP, PRIORITY_MAP, LINE_MAP } from '../constants';
import { toast, toastError } from '../stores/toast';
import SegmentTabs from './SegmentTabs.vue';

const emit = defineEmits(['processed']);

const content = ref('');
const category = ref('');
const priority = ref('');
const line = ref('trial'); // 默认 TODO 线
const processing = ref(false);

const charCount = computed(() => content.value.length);
const isLikelyUrl = computed(() => /^https?:\/\/\S+$/i.test(content.value.trim()));

// 双线拨片：切换时输入框弥散光晕随之冰蓝 ↔ 暖橙（环境光语义）
const LINE_TABS = Object.entries(LINE_MAP).map(([key, l]) => ({
  key,
  label: key === 'trial' ? '代试 Action' : '内容 Media',
  icon: l.icon,
}));

const EXAMPLES = [
  'https://mp.weixin.qq.com/s/xxxx（公众号文章链接）',
  '建议每天写 500 字锻炼表达，先注册一个公众号…',
  '刚听播客收获：个人品牌定位 = 我帮【谁】用【什么】解决【什么】',
];

async function submit() {
  if (!content.value.trim() || processing.value) return;
  processing.value = true;
  try {
    const res = await processInput({
      content: content.value.trim(),
      source_type: isLikelyUrl.value ? 'url' : 'text',
      preferred_category: category.value || undefined,
      preferred_priority: priority.value || undefined,
      line: line.value,
    });
    const n = res.extracted_todos?.length || 0;
    const noun = line.value === 'media' ? '条内容工序' : '条 TODO';
    toast(`已入库「${res.processed_item.title.slice(0, 20)}」${n ? `，提取 ${n} ${noun}` : ''}`, 'success');
    content.value = '';
    emit('processed', res);
  } catch (e) {
    if (e.status === 409 && e.data?.duplicate_of) {
      toast(e.message, 'info', 5000);
    } else {
      toastError(e.message);
    }
  } finally {
    processing.value = false;
  }
}
</script>

<template>
  <div class="quick-input glass-panel" :class="{ 'quick-input--media': line === 'media' }">
    <div class="quick-input__glow quick-input__glow--cold" aria-hidden="true" />
    <div class="quick-input__glow quick-input__glow--warm" aria-hidden="true" />

    <div class="quick-input__header">
      <SegmentTabs v-model="line" :tabs="LINE_TABS" class="quick-input__lines" />
      <span class="quick-input__title">快速输入</span>
      <span class="quick-input__hint">
        {{ isLikelyUrl ? '🔗 检测到链接，将自动抓取正文' : '粘贴 URL / 文本 / 想法，交给私秘 Agent 处理' }}
      </span>
    </div>

    <div class="quick-input__inputwrap">
      <textarea
        v-model="content"
        class="glass-input quick-input__textarea"
        placeholder="粘贴 URL、复制一段文字，或随手记一个想法…"
        :disabled="processing"
        @keydown.meta.enter="submit"
        @keydown.ctrl.enter="submit"
      />
      <span class="quick-input__kbd" aria-hidden="true">⌘ ↵</span>
    </div>

    <div v-if="!content" class="quick-input__examples">
      <span class="quick-input__examples-label">试试：</span>
      <button v-for="ex in EXAMPLES" :key="ex" class="tag-chip" @click="content = ex.replace(/（.*）$/, '')">
        {{ ex.slice(0, 22) }}…
      </button>
    </div>

    <div class="quick-input__toolbar">
      <div class="quick-input__selects">
        <select v-model="category" class="glass-select glass-input quick-input__select">
          <option value="">Agent 自动分类</option>
          <option v-for="(c, key) in CATEGORY_MAP" :key="key" :value="key">{{ c.icon }} {{ c.label }}</option>
        </select>
        <select v-model="priority" class="glass-select glass-input quick-input__select">
          <option value="">Agent 评估优先级</option>
          <option v-for="(p, key) in PRIORITY_MAP" :key="key" :value="key">{{ p.label }}优先级</option>
        </select>
        <span v-if="charCount" class="timestamp">{{ charCount }} 字</span>
      </div>

      <button class="btn btn--primary" :disabled="!content.trim() || processing" @click="submit">
        <span v-if="processing" class="spinner" />
        {{ processing ? '私秘处理中…' : '🚀 处理' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.quick-input {
  position: relative;
  padding: var(--space-12);
}

/* ===== 命令框弥散光晕：随业务线冰蓝 ↔ 暖橙交叉淡化 ===== */
.quick-input__glow {
  position: absolute;
  inset: -4px;
  border-radius: var(--radius-lg);
  filter: blur(28px);
  pointer-events: none;
  transition: opacity 600ms ease;
}
.quick-input__glow--cold {
  background: linear-gradient(135deg, rgba(34, 211, 238, 0.4), rgba(99, 102, 241, 0.32));
  opacity: 0.55;
}
.quick-input__glow--warm {
  background: linear-gradient(135deg, rgba(251, 146, 60, 0.45), rgba(251, 191, 36, 0.35));
  opacity: 0;
}
.quick-input--media .quick-input__glow--cold { opacity: 0; }
.quick-input--media .quick-input__glow--warm { opacity: 0.6; }

.quick-input__header,
.quick-input__inputwrap,
.quick-input__examples,
.quick-input__toolbar { position: relative; } /* 抬到光晕之上 */

.quick-input__header {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  margin-bottom: var(--space-6);
  flex-wrap: wrap;
}
.quick-input__title { font: var(--font-h3); }
.quick-input__hint { font: var(--font-micro); color: var(--text-muted); }
.quick-input__lines { flex-shrink: 0; }

.quick-input__inputwrap { position: relative; }
.quick-input__textarea { min-height: 110px; }
.quick-input__textarea:disabled { opacity: 0.6; }

/* 半透明键盘按键提示 */
.quick-input__kbd {
  position: absolute;
  right: 12px;
  bottom: 12px;
  padding: 3px 9px;
  font: var(--font-micro);
  color: var(--text-muted);
  background: var(--glass-bg-strong);
  border: 1px solid var(--glass-border);
  border-bottom-width: 2px;
  border-radius: 6px;
  pointer-events: none;
}

.quick-input__examples {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-4);
}
.quick-input__examples-label { font: var(--font-micro); color: var(--text-muted); }

.quick-input__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-5);
  margin-top: var(--space-6);
  flex-wrap: wrap;
}

.quick-input__selects {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}
.quick-input__select {
  width: auto;
  padding-top: 9px;
  padding-bottom: 9px;
  font: var(--font-secondary);
}

@media (max-width: 768px) {
  .quick-input__toolbar { flex-direction: column; align-items: stretch; }
  .quick-input__selects { width: 100%; }
  .quick-input__select { flex: 1; }
}
</style>
