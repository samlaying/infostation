<script setup>
// ===== 卡片 Inspector（信息库右侧详情抽屉）· v2.1/v2.2 =====
// 取代信息库右侧的统计侧栏（分类分布/标签云归数据看板管，MECE）。
// 职责：深读选中卡片 —— 正文、Agent 截图/生图资产、名下 TODO 直接打勾、关联跳转、
// v2.2 预处理任务进度（技能步骤 ✓/○/✗ + 重跑）。
import { computed, ref, reactive, watch, onBeforeUnmount } from 'vue';
import { useTodosStore } from '../stores/todos';
import { PLATFORM_MAP, PRIORITY_MAP, FORM_MAP, itemForm, timeAgo, fmtDate } from '../constants';
import { fetchJobs, reprocessItem, patchItem } from '../api';
import { toastError, toastSuccess } from '../stores/toast';

const props = defineProps({
  item: { type: Object, required: true }, // 完整 detail（含 todos / assets / related_items）
  wide: { type: Boolean, default: false }, // 宽屏编辑模式
});
const emit = defineEmits(['close', 'edit', 'open-related', 'toggle-wide']);

const todosStore = useTodosStore();
const form = computed(() => itemForm(props.item));
const jobs = ref([]);
const reprunning = ref(false);

// ===== v2.2 就地实时编辑（思考笔记核心交互）：本地副本 + 防抖自动保存 =====
// 输入即落库（PATCH → SSE 广播 → 左侧卡片同步刷新），不弹 Modal 不点保存。
const edit = reactive({ title: '', summary: '', points: [] });
const saveState = ref('idle'); // idle | saving | saved
let saveTimer = null;
let pendingPatch = {};
let pendingFor = null; // 待冲刷输入所属的卡片 id（切卡时按原 id 落盘，避免串卡）

watch(
  () => props.item?.id,
  (id) => {
    jobs.value = [];
    if (id) {
      fetchJobs({ item_id: id })
        .then((res) => { jobs.value = res.jobs || []; })
        .catch(() => {});
    }
    // 切卡/关闭前若有未落盘的输入，按原卡片冲刷
    flushSave();
    edit.title = props.item?.title || '';
    edit.summary = props.item?.summary || '';
    edit.points = [...(props.item?.key_points || [])];
  },
  { immediate: true }
);

onBeforeUnmount(flushSave);

function queueSave(patch) {
  pendingFor ||= props.item?.id;
  Object.assign(pendingPatch, patch);
  saveState.value = 'saving';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 700);
}

async function flushSave() {
  clearTimeout(saveTimer);
  if (!Object.keys(pendingPatch).length || !pendingFor) return;
  const id = pendingFor;
  const body = pendingPatch;
  pendingPatch = {};
  pendingFor = null;
  try {
    await patchItem(id, body);
    saveState.value = 'saved';
    setTimeout(() => { if (saveState.value === 'saved') saveState.value = 'idle'; }, 1500);
  } catch (e) {
    saveState.value = 'idle';
    toastError(`自动保存失败：${e.message}`);
  }
}

const saveHint = computed(() =>
  saveState.value === 'saving' ? '保存中…' : saveState.value === 'saved' ? '✓ 已自动保存' : ''
);

// 要点编辑：整组防抖提交
function savePoints() {
  queueSave({ key_points: edit.points.filter((p) => p.trim()) });
}
function updatePoint(i, v) {
  edit.points[i] = v;
  savePoints();
}
function removePoint(i) {
  edit.points.splice(i, 1);
  savePoints();
}
function addPoint() {
  edit.points.push('');
}

// 要点输入框自动增高（v-auto-grow）：内容或外部更新都随文字行数生长
const vAutoGrow = {
  mounted: autoGrow,
  updated: autoGrow,
};
function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

const activeJob = computed(() => jobs.value.find((j) => ['pending', 'running', 'waiting_local'].includes(j.status)));
const STEP_ICON = { done: '✓', running: '◐', failed: '✗', pending: '○' };

async function rerun() {
  reprunning.value = true;
  try {
    await reprocessItem(props.item.id);
    toastSuccess('预处理已重新启动 🤖');
    const res = await fetchJobs({ item_id: props.item.id });
    jobs.value = res.jobs || [];
  } catch (e) {
    toastError(e.message);
  } finally {
    reprunning.value = false;
  }
}

async function toggleTodo(t) {
  try {
    const next = t.status === 'done' ? 'pending' : 'done';
    await todosStore.update(t.id, { status: next });
    t.status = next;
    t.completed_at = next === 'done' ? new Date().toISOString() : null;
    if (next === 'done') toastSuccess('已完成 ✓');
  } catch (e) {
    toastError(e.message);
  }
}

/** 可预览的资产：有远程 URL 的直接出图；本地路径的给占位（由本地 Agent 上传图床后回填 --url） */
const previewAssets = computed(() => (props.item.assets || []).filter((a) => a.remote_url));
</script>

<template>
  <aside class="inspector glass-panel">
    <header class="inspector__header">
      <div class="inspector__header-tags">
        <span class="inspector__form">{{ FORM_MAP[form].icon }} {{ FORM_MAP[form].label }}</span>
        <span v-if="item.topic_name" class="inspector__topic">📁 {{ item.topic_name }}</span>
      </div>
      <div class="inspector__header-actions">
        <button class="btn btn--glass btn--sm" :title="wide ? '收窄侧栏' : '放宽编辑区（近半屏）'" @click="emit('toggle-wide')">
          {{ wide ? '⤡ 收窄' : '⤢ 放宽' }}
        </button>
        <button class="btn btn--glass btn--sm" @click="emit('edit')">✎ 编辑</button>
        <button class="btn btn--glass btn--sm" @click="emit('close')">收起 ✕</button>
      </div>
    </header>

    <div class="inspector__body">
      <!-- v2.2 就地实时编辑：标题 / 摘要 / 要点，输入即自动保存 -->
      <input
        v-model="edit.title"
        class="inspector__title-input"
        placeholder="标题"
        @input="queueSave({ title: edit.title })"
      />
      <div class="inspector__meta">
        <span class="timestamp">🕐 {{ timeAgo(item.created_at) }}</span>
        <span v-if="item.source_platform && item.source_platform !== 'manual'" class="timestamp">
          {{ PLATFORM_MAP[item.source_platform] || item.source_platform }}
        </span>
        <a v-if="item.source_url" class="inspector__link" :href="item.source_url" target="_blank" rel="noopener">
          查看原文 ↗
        </a>
        <span class="timestamp">Agent 置信度 {{ Math.round((item.agent_confidence || 0) * 100) }}%</span>
        <span v-if="saveHint" class="inspector__savehint" :class="`is-${saveState}`">{{ saveHint }}</span>
      </div>

      <textarea
        v-auto-grow
        v-model="edit.summary"
        class="inspector__summary-input"
        rows="3"
        placeholder="一句话摘要…"
        @input="queueSave({ summary: edit.summary })"
      />

      <!-- v2.2 预处理任务进度：技能步骤逐项点亮 + 失败重跑 -->
      <section v-if="jobs.length" class="inspector__section">
        <h3>
          🤖 Agent 预处理
          <span v-if="activeJob" class="inspector__job-live">
            <span class="inspector__pulse" />{{ activeJob.current_step || '进行中…' }}
          </span>
          <span v-else-if="jobs[0].status === 'failed'" class="timestamp">部分失败</span>
        </h3>
        <div class="inspector__job">
          <div v-for="(l, i) in jobs[0].logs" :key="i" class="inspector__job-step" :class="`is-${l.status}`">
            <span class="inspector__job-icon">{{ STEP_ICON[l.status] || '○' }}</span>
            <span class="inspector__job-name">{{ l.skill }}</span>
            <span class="timestamp">{{ l.error ? l.error.slice(0, 40) : (l.result?.asset_url ? '已存截图' : '') }}</span>
          </div>
          <div v-for="s in jobs[0].skills_plan.slice(jobs[0].logs.length)" :key="s.skill" class="inspector__job-step is-pending">
            <span class="inspector__job-icon">○</span>
            <span class="inspector__job-name">{{ s.skill }}</span>
            <span class="timestamp">{{ s.runtime === 'local' ? '待本地 Agent' : '排队中' }}</span>
          </div>
          <button v-if="!activeJob" class="btn btn--glass btn--sm inspector__rerun" :disabled="reprunning" @click="rerun">
            {{ reprunning ? '启动中…' : '↻ 重新预处理' }}
          </button>
        </div>
      </section>

      <!-- Agent 视觉资产：截图 / 生图 / 图床 -->
      <section v-if="item.assets?.length" class="inspector__section">
        <h3>🖼 视觉资产（{{ item.assets.length }}）</h3>
        <div class="inspector__assets">
          <a
            v-for="a in previewAssets"
            :key="a.id"
            class="inspector__asset"
            :href="a.remote_url"
            target="_blank"
            rel="noopener"
            :title="`${a.asset_type}${a.prompt ? ' · ' + a.prompt : ''}`"
          >
            <img :src="a.remote_url" loading="lazy" alt="" />
          </a>
          <div
            v-for="a in (item.assets || []).filter((x) => !x.remote_url)"
            :key="`local-${a.id}`"
            class="inspector__asset inspector__asset--local"
            :title="a.local_path"
          >
            📎 {{ a.asset_type === 'screenshot' ? '截图' : a.asset_type === 'ai_image' ? '生图' : '文件' }}（待上传图床）
          </div>
        </div>
      </section>

      <section class="inspector__section">
        <h3>💡 关键要点 <span class="inspector__edit-hint">点击直接编辑</span></h3>
        <div class="inspector__points">
          <div v-for="(p, i) in edit.points" :key="i" class="inspector__point-row">
            <textarea
              v-auto-grow
              :value="p"
              rows="1"
              class="inspector__point-input"
              placeholder="写一条要点…"
              @input="updatePoint(i, $event.target.value)"
              @keydown.enter.prevent="$event.target.blur()"
            />
            <button class="inspector__point-del" title="删除这条要点" @click="removePoint(i)">✕</button>
          </div>
          <button class="inspector__point-add" @click="addPoint">＋ 添加要点</button>
        </div>
      </section>

      <section v-if="item.todos?.length" class="inspector__section">
        <h3>📋 TODO（{{ item.todos.filter((t) => t.status === 'done').length }}/{{ item.todos.length }}）</h3>
        <div class="inspector__todos">
          <div v-for="t in item.todos" :key="t.id" class="inspector__todo" @click="toggleTodo(t)">
            <span class="inspector__todo-check" :class="{ 'is-done': t.status === 'done' }">
              <template v-if="t.status === 'done'">✓</template>
            </span>
            <span class="inspector__todo-title" :class="{ 'is-done': t.status === 'done' }">{{ t.title }}</span>
            <span class="priority-dot" :class="`priority-dot--${t.priority}`" :title="`${PRIORITY_MAP[t.priority]?.label}优先级`" />
            <span class="timestamp">📅 {{ fmtDate(t.actual_deadline || t.suggested_deadline) }}</span>
          </div>
        </div>
      </section>

      <section v-if="item.related_items?.length" class="inspector__section">
        <h3>🔗 关联内容（{{ item.related_items.length }}）</h3>
        <div class="inspector__related">
          <button v-for="r in item.related_items" :key="r.id" class="tag-chip" @click="emit('open-related', r.id)">
            {{ r.title.slice(0, 24) }}
          </button>
        </div>
      </section>

      <section class="inspector__section">
        <h3>📄 清洗后全文</h3>
        <p class="inspector__content">{{ item.full_content || '（无内容）' }}</p>
      </section>

      <div v-if="item.agent_note" class="inspector__note">🤖 {{ item.agent_note }}</div>
    </div>
  </aside>
</template>

<style scoped>
.inspector {
  position: sticky;
  top: 88px;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 108px);
  overflow: hidden;
}

.inspector__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-7) var(--space-9);
  border-bottom: 1px solid var(--glass-border);
  flex-wrap: wrap;
}
.inspector__header-tags { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.inspector__form, .inspector__topic {
  font: var(--font-caption);
  padding: 3px 10px;
  border-radius: var(--radius-full);
  border: 1px solid var(--glass-border);
}
.inspector__topic { color: var(--accent-blue); border-color: rgba(37, 99, 235, 0.3); background: rgba(37, 99, 235, 0.07); }
.inspector__header-actions { display: flex; gap: var(--space-3); }

.inspector__body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-8) var(--space-9);
  display: flex;
  flex-direction: column;
  gap: var(--space-7);
}

.inspector__title { font: var(--font-h2); line-height: 1.4; }
.inspector__meta { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-5); }
.inspector__link { font: var(--font-caption); color: var(--accent-cyan); text-decoration: none; }
.inspector__link:hover { text-decoration: underline; }

/* ===== v2.2 就地编辑输入框：无边框融入排版，聚焦时下划线点亮 ===== */
.inspector__title-input {
  width: 100%;
  font: var(--font-h2);
  color: var(--text-primary);
  background: transparent;
  border: none;
  border-bottom: 1.5px dashed transparent;
  padding: 2px 0 6px;
  outline: none;
  transition: border-color var(--transition-fast);
}
.inspector__title-input:hover { border-bottom-color: var(--glass-border-hover); }
.inspector__title-input:focus { border-bottom-color: var(--accent-blue); border-bottom-style: solid; }

.inspector__summary-input {
  width: 100%;
  min-height: 78px; /* 3 行起步，v-auto-grow 随内容增高 */
  font: var(--font-secondary);
  color: var(--text-primary);
  line-height: 1.8;
  background: var(--glass-bg-faint);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  padding: var(--space-6);
  outline: none;
  resize: vertical;
  overflow: hidden;
  overflow-wrap: break-word;
  transition: border-color var(--transition-fast);
}
.inspector__summary-input:hover { border-color: var(--glass-border); }
.inspector__summary-input:focus { border-color: var(--accent-blue); }

.inspector__savehint { font: var(--font-micro); }
.inspector__savehint.is-saving { color: var(--accent-orange); }
.inspector__savehint.is-saved { color: var(--accent-green); }
.inspector__edit-hint { font: var(--font-micro); color: var(--text-muted); text-transform: none; letter-spacing: 0; }

/* 要点行编辑（textarea 自动增高，长要点换行不截断） */
.inspector__points { display: flex; flex-direction: column; gap: var(--space-4); }
.inspector__point-row { display: flex; align-items: flex-start; gap: var(--space-3); }
.inspector__point-input {
  flex: 1;
  min-width: 0;
  font: var(--font-secondary);
  color: var(--text-primary);
  line-height: 1.7;
  background: var(--glass-bg-faint);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  padding: var(--space-4) var(--space-5);
  outline: none;
  resize: none;
  overflow: hidden;
  overflow-wrap: break-word;
  transition: border-color var(--transition-fast);
}
.inspector__point-input:hover { border-color: var(--glass-border); }
.inspector__point-input:focus { border-color: var(--accent-blue); }
.inspector__point-input::placeholder { color: var(--text-muted); }
.inspector__point-del {
  color: var(--text-muted);
  font-size: 12px;
  padding: var(--space-3) 6px;
  border-radius: var(--radius-xs);
  opacity: 0;
  transition: all var(--transition-fast);
}
.inspector__point-row:hover .inspector__point-del { opacity: 1; }
.inspector__point-del:hover { color: var(--accent-red); background: var(--glass-hover); }
.inspector__point-add {
  align-self: flex-start;
  font: var(--font-micro);
  color: var(--text-muted);
  padding: var(--space-2) var(--space-5);
  border: 1px dashed var(--glass-border);
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}
.inspector__point-add:hover { color: var(--accent-blue); border-color: var(--accent-blue); }

.inspector__section h3 {
  font: var(--font-caption);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-bottom: var(--space-4);
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

/* v2.2 任务进度 */
.inspector__job { display: flex; flex-direction: column; gap: var(--space-3); }
.inspector__job-live {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  font: var(--font-micro);
  color: var(--accent-purple);
  text-transform: none;
  letter-spacing: 0;
}
.inspector__pulse {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--accent-purple);
  box-shadow: 0 0 8px rgba(147, 51, 234, 0.6);
  animation: inspector-pulse 1.4s ease-in-out infinite;
}
@keyframes inspector-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
.inspector__job-step {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  font: var(--font-micro);
  color: var(--text-secondary);
  padding: var(--space-2) var(--space-4);
  background: var(--glass-bg-faint);
  border-radius: var(--radius-xs);
}
.inspector__job-step.is-done { color: var(--accent-green); }
.inspector__job-step.is-running { color: var(--accent-purple); }
.inspector__job-step.is-failed { color: var(--accent-red); }
.inspector__job-icon { width: 14px; text-align: center; }
.inspector__job-name { flex: 1; }
.inspector__rerun { align-self: flex-start; margin-top: var(--space-2); }

.inspector__assets { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: var(--space-4); }
.inspector__asset {
  aspect-ratio: 3 / 2;
  border-radius: var(--radius-sm);
  overflow: hidden;
  border: 1px solid var(--glass-border);
  display: flex;
  align-items: center;
  justify-content: center;
}
.inspector__asset img { width: 100%; height: 100%; object-fit: cover; }
.inspector__asset--local {
  font: var(--font-micro);
  color: var(--text-secondary);
  padding: var(--space-3);
  text-align: center;
  border-style: dashed;
}

.inspector__points {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.inspector__points li {
  font: var(--font-secondary);
  color: var(--text-primary);
  line-height: 1.6;
  padding: var(--space-3) var(--space-5);
  background: var(--glass-bg-faint);
  border-radius: var(--radius-sm);
}

.inspector__todos { display: flex; flex-direction: column; gap: var(--space-3); }
.inspector__todo {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  background: var(--glass-bg-faint);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
}
.inspector__todo:hover { background: var(--glass-hover); }
.inspector__todo-check {
  width: 18px;
  height: 18px;
  min-width: 18px;
  border: 1.5px solid var(--glass-border-hover);
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #fff;
}
.inspector__todo-check.is-done { background: var(--accent-green); border-color: var(--accent-green); }
.inspector__todo-title { flex: 1; font: var(--font-secondary); }
.inspector__todo-title.is-done { text-decoration: line-through; opacity: 0.55; }

.inspector__related { display: flex; flex-wrap: wrap; gap: var(--space-3); }

.inspector__content {
  font: var(--font-secondary);
  color: var(--text-secondary);
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
  padding: var(--space-6);
  background: var(--glass-bg-faint);
  border-radius: var(--radius-sm);
}

.inspector__note {
  font: var(--font-secondary);
  color: var(--accent-cyan);
  padding: var(--space-6);
  background: rgba(6, 182, 212, 0.06);
  border: 1px solid rgba(6, 182, 212, 0.2);
  border-radius: var(--radius-sm);
  line-height: 1.7;
  white-space: pre-wrap;
}
</style>
