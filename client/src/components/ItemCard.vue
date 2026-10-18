<script setup>
// ===== 知识卡片 · v2.1 四形态 + 状态机行动条 =====
// 形态（MECE）：link=网页/项目（↗直达）| note=思考笔记（要点置中）| idea/bundle 由内容生产接管
// 行动条（状态机）：有未完 TODO → 下一步+直接打勾；无 TODO → 提示转化/打开原文；全部完成 → 🎉 转为选题
import { computed } from 'vue';
import { FORM_MAP, PRIORITY_MAP, PLATFORM_MAP, LINE_MAP, itemForm, timeAgo } from '../constants';
import { patchTodo, patchItem } from '../api';
import { toastError, toastSuccess } from '../stores/toast';

const props = defineProps({
  item: { type: Object, required: true },
  index: { type: Number, default: 0 },
  selected: { type: Boolean, default: false },
});
const emit = defineEmits(['open', 'delete']);

const form = computed(() => itemForm(props.item));
const formMeta = computed(() => FORM_MAP[form.value]);
const todoCount = computed(() => props.item.todo_count ?? 0);
const todoDone = computed(() => props.item.todo_done_count ?? 0);
const allDone = computed(() => todoCount.value > 0 && !props.item.next_todo_id);

// v2.2 预处理状态：活跃 job 显示呼吸灯；产物按已落库的字段推导徽章
const jobActive = computed(() => ['pending', 'running', 'waiting_local'].includes(props.item.job_status));
const badges = computed(() => {
  const b = [];
  if (props.item.asset_count > 0) b.push(`🖼 ${props.item.asset_count} 图`);
  if ((props.item.agent_note || '').includes('已 Clone')) b.push('💻 已 Clone');
  if ((props.item.agent_note || '').includes('前置调研')) b.push('🔍 调研简报');
  return b;
});

async function completeNext() {
  try {
    await patchTodo(props.item.next_todo_id, { status: 'done' });
    toastSuccess('已完成 ✓');
    // SSE todos update 会驱动视图重拉，这里不用手动刷新
  } catch (e) {
    toastError(e.message);
  }
}

// 代试线闭环 → 转自媒体线选题（打通 trial → media）
async function toMediaIdea() {
  try {
    await patchItem(props.item.id, { line: 'media', item_type: 'idea' });
    toastSuccess('已转为内容生产选题 ✍️');
  } catch (e) {
    toastError(e.message);
  }
}
</script>

<template>
  <article
    class="item-card glass-card glass-card--hover fade-in"
    :class="{ 'item-card--selected': selected }"
    :style="{ '--delay': `${Math.min(index, 12) * 60}ms` }"
    @click="emit('open', item)"
  >
    <header class="item-card__header">
      <span class="item-card__cat">
        <template v-if="item.topic_name">📁 {{ item.topic_name }}</template>
        <template v-else>{{ LINE_MAP[item.line || 'trial']?.icon }} {{ LINE_MAP[item.line || 'trial']?.short }}</template>
      </span>
      <div class="item-card__header-right">
        <span v-if="item.agent_confidence < 0.7" class="item-card__lowconf" title="Agent 置信度较低">?</span>
        <span
          class="item-card__line"
          :class="`item-card__line--${item.line || 'trial'}`"
          :title="item.line === 'media' ? '自媒体线 · 内容生产' : 'TODO 线 · 行动项'"
        />
        <span class="priority-dot" :class="`priority-dot--${item.priority}`" :title="`${PRIORITY_MAP[item.priority]?.label}优先级`" />
        <a
          v-if="form === 'link' && item.source_url"
          class="item-card__src"
          :href="item.source_url"
          target="_blank"
          rel="noopener"
          title="打开原网页"
          @click.stop
        >↗</a>
      </div>
    </header>

    <h3 class="item-card__title">{{ item.title }}</h3>

    <!-- 思考笔记形态：核心要点直接置中渲染 -->
    <ul v-if="form === 'note' && item.key_points?.length" class="item-card__points">
      <li v-for="(k, i) in item.key_points.slice(0, 3)" :key="i">{{ k }}</li>
    </ul>
    <p v-else class="item-card__summary clamp-4">{{ item.summary }}</p>

    <div v-if="item.tags?.length" class="item-card__tags">
      <span v-for="t in item.tags.slice(0, 4)" :key="t" class="tag-chip" @click.stop>#{{ t }}</span>
    </div>

    <!-- v2.2 预制件徽章：Agent 已备好的弹药 -->
    <div v-if="badges.length" class="item-card__badges2">
      <span v-for="b in badges" :key="b" class="item-card__badge2">{{ b }}</span>
    </div>

    <!-- 状态机行动条：任何时刻只有一个高亮的下一步 -->
    <footer class="item-card__action">
      <!-- 预处理进行中：紫色呼吸灯（唯一暂时高亮的行） -->
      <template v-if="jobActive">
        <span class="item-card__preexec">
          <span class="item-card__pulse" />🔄 {{
            item.job_status === 'waiting_local' ? '等待本地 Agent 认领' : (item.job_step || 'Agent 预处理中…')
          }}
        </span>
        <span class="item-card__meta-right">
          <span class="timestamp">{{ timeAgo(item.created_at) }}</span>
          <button class="icon-btn" title="删除" @click.stop="emit('delete', item)">✕</button>
        </span>
      </template>
      <!-- 状态 1：还有未完 TODO → 下一步 + 直接打勾 -->
      <template v-else-if="item.next_todo_id">
        <span class="item-card__next">👉 下一步：{{ item.next_todo_title }}</span>
        <span class="item-card__progress">{{ todoDone }}/{{ todoCount }}</span>
        <button class="item-card__cta item-card__cta--check" title="直接完成这条 TODO" @click.stop="completeNext">☑️</button>
      </template>
      <!-- 状态 2：无 TODO → 提示转化（link 形态给原网页直达） -->
      <template v-else-if="todoCount === 0">
        <span class="item-card__next">👉 尚未转化为行动</span>
        <a
          v-if="form === 'link' && item.source_url"
          class="item-card__cta"
          :href="item.source_url"
          target="_blank"
          rel="noopener"
          @click.stop
        >↗ 原网页</a>
      </template>
      <!-- 状态 3：全部完成 → 达成态 + 打通到自媒体线 -->
      <template v-else>
        <span class="item-card__done">🎉 已全部跑通（{{ todoCount }}/{{ todoCount }}）</span>
        <button class="item-card__cta item-card__cta--media" title="带着这张卡（含资产）转为内容生产选题" @click.stop="toMediaIdea">✍️ 转为选题</button>
      </template>

      <span class="item-card__meta-right">
        <span v-if="item.related_count" class="item-card__badge">🔗 {{ item.related_count }}</span>
        <span v-if="item.source_platform && item.source_platform !== 'manual'" class="timestamp">
          {{ PLATFORM_MAP[item.source_platform] || item.source_platform }}
        </span>
        <span class="timestamp">{{ timeAgo(item.created_at) }}</span>
        <button class="icon-btn" title="删除" @click.stop="emit('delete', item)">✕</button>
      </span>
    </footer>
  </article>
</template>

<style scoped>
.item-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-11);
  cursor: pointer;
  border: 1px solid transparent;
}
.item-card--selected {
  border-color: var(--accent-blue);
  box-shadow: 0 0 0 1px var(--accent-blue), 0 8px 28px rgba(37, 99, 235, 0.18);
}

.item-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.item-card__cat {
  font: var(--font-micro);
  padding: 3px 10px;
  border-radius: var(--radius-full);
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
}

.item-card__header-right { display: flex; align-items: center; gap: var(--space-4); }

/* 业务线色标（磨砂色点：蓝=代试 / 橙=内容） */
.item-card__line {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.item-card__line--trial { background: var(--line-trial); box-shadow: 0 0 6px rgba(8, 145, 178, 0.45); }
.item-card__line--media { background: var(--line-media); box-shadow: 0 0 6px rgba(234, 88, 12, 0.45); }

.item-card__lowconf {
  font: var(--font-micro);
  color: var(--accent-orange);
  border: 1px solid var(--accent-orange);
  border-radius: 50%;
  width: 15px;
  height: 15px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.item-card__src {
  font-size: 13px;
  color: var(--accent-cyan);
  text-decoration: none;
  padding: 2px 7px;
  border: 1px solid rgba(6, 182, 212, 0.35);
  border-radius: var(--radius-full);
  transition: background var(--transition-fast);
}
.item-card__src:hover { background: rgba(6, 182, 212, 0.12); }

.item-card__title {
  font: var(--font-h3);
  color: var(--text-primary);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.item-card__summary {
  font: var(--font-secondary);
  color: var(--text-secondary);
  flex: 1;
}

/* 思考笔记：要点带底色 bullet */
.item-card__points {
  list-style: none;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.item-card__points li {
  font: var(--font-secondary);
  color: var(--text-primary);
  line-height: 1.55;
  padding: var(--space-3) var(--space-5);
  padding-left: var(--space-8);
  background: var(--glass-bg-faint);
  border-radius: var(--radius-sm);
  position: relative;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.item-card__points li::before {
  content: '◆';
  position: absolute;
  left: var(--space-4);
  top: var(--space-3);
  font-size: 9px;
  color: var(--accent-blue);
}

.item-card__tags { display: flex; flex-wrap: wrap; gap: var(--space-2); }

/* v2.2 预制件徽章 + 预处理呼吸灯 */
.item-card__badges2 { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.item-card__badge2 {
  font: var(--font-micro);
  color: var(--accent-purple);
  background: rgba(147, 51, 234, 0.07);
  border: 1px solid rgba(147, 51, 234, 0.25);
  padding: 2px 9px;
  border-radius: var(--radius-full);
}
.item-card__preexec {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  font: var(--font-caption);
  color: var(--accent-purple);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.item-card__pulse {
  width: 8px;
  height: 8px;
  min-width: 8px;
  border-radius: 50%;
  background: var(--accent-purple);
  box-shadow: 0 0 8px rgba(147, 51, 234, 0.6);
  animation: item-preexec-pulse 1.4s ease-in-out infinite;
}
@keyframes item-preexec-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* ===== 状态机行动条 ===== */
.item-card__action {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  margin-top: var(--space-2);
  background: rgba(8, 145, 178, 0.06);
  border: 1px solid rgba(8, 145, 178, 0.18);
  border-radius: var(--radius-sm);
}
.item-card__next {
  flex: 1;
  min-width: 0;
  font: var(--font-caption);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.item-card__progress { font: var(--font-micro); color: var(--text-secondary); white-space: nowrap; }
.item-card__done { flex: 1; font: var(--font-caption); color: var(--accent-green); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.item-card__cta {
  font: var(--font-micro);
  color: var(--accent-cyan);
  cursor: pointer;
  white-space: nowrap;
  padding: 3px 10px;
  border: 1px solid rgba(6, 182, 212, 0.4);
  border-radius: var(--radius-full);
  text-decoration: none;
  transition: background var(--transition-fast), box-shadow var(--transition-fast);
}
.item-card__cta:hover { background: rgba(6, 182, 212, 0.12); }
.item-card__cta--check { color: var(--accent-green); border-color: rgba(5, 150, 105, 0.45); }
.item-card__cta--check:hover { background: rgba(5, 150, 105, 0.12); box-shadow: 0 0 8px rgba(5, 150, 105, 0.25); }
.item-card__cta--media {
  color: var(--line-media);
  border-color: rgba(234, 88, 12, 0.45);
  background: linear-gradient(135deg, rgba(251, 146, 60, 0.12), rgba(251, 191, 36, 0.1));
  font-weight: 600;
}
.item-card__cta--media:hover { box-shadow: 0 0 10px rgba(234, 88, 12, 0.3); }

.item-card__meta-right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-left: auto;
}
.item-card__badge {
  font: var(--font-micro);
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  padding: 2px 8px;
  border-radius: var(--radius-full);
}

.icon-btn {
  padding: 4px;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  font-size: 12px;
  transition: all var(--transition-fast);
}
.icon-btn:hover { color: var(--accent-red); background: var(--glass-hover); }
</style>
