<script setup>
import { ref, computed } from 'vue';
import { processInput } from '../api';
import { CATEGORY_MAP, PRIORITY_MAP } from '../constants';
import { toast, toastError } from '../stores/toast';

const emit = defineEmits(['processed']);

const content = ref('');
const category = ref('');
const priority = ref('');
const processing = ref(false);

const charCount = computed(() => content.value.length);
const isLikelyUrl = computed(() => /^https?:\/\/\S+$/i.test(content.value.trim()));

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
    });
    const n = res.extracted_todos?.length || 0;
    toast(`已入库「${res.processed_item.title.slice(0, 20)}」${n ? `，提取 ${n} 条 TODO` : '（无 TODO）'}`, 'success');
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
  <div class="quick-input glass-panel">
    <div class="quick-input__header">
      <span class="quick-input__icon">📥</span>
      <span class="quick-input__title">快速输入</span>
      <span class="quick-input__hint">
        {{ isLikelyUrl ? '🔗 检测到链接，将自动抓取正文' : '粘贴 URL / 文本 / 想法，交给私秘 Agent 处理' }}
      </span>
    </div>

    <textarea
      v-model="content"
      class="glass-input quick-input__textarea"
      placeholder="粘贴 URL、复制一段文字，或随手记一个想法…（Ctrl/⌘ + Enter 处理）"
      :disabled="processing"
      @keydown.meta.enter="submit"
      @keydown.ctrl.enter="submit"
    />

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
.quick-input { padding: var(--space-12); }

.quick-input__header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}
.quick-input__title { font: var(--font-h3); }
.quick-input__hint { font: var(--font-micro); color: var(--text-muted); }

.quick-input__textarea { min-height: 110px; }
.quick-input__textarea:disabled { opacity: 0.6; }

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
