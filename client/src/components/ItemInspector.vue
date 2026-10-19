<script setup>
// ===== 卡片 Inspector（信息库右侧详情抽屉）· v2.1/v2.2 =====
// 取代信息库右侧的统计侧栏（分类分布/标签云归数据看板管，MECE）。
// 职责：深读选中卡片 —— 正文、Agent 截图/生图资产、名下 TODO 直接打勾、关联跳转、
// v2.2 预处理任务进度（技能步骤 ✓/○/✗ + 重跑）。
import { computed, ref, reactive, watch, onBeforeUnmount, nextTick } from 'vue';
import { marked } from 'marked';
import { useTodosStore } from '../stores/todos';
import { PLATFORM_MAP, PRIORITY_MAP, FORM_MAP, itemForm, timeAgo, fmtDate } from '../constants';
import { fetchJobs, reprocessItem, patchItem, approveJob, createTodo } from '../api';
import { subscribeLive } from '../api/live';
import { toastError, toastSuccess, toast } from '../stores/toast';

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
    viewer.asset = null;
    closeSelMenu();
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

onBeforeUnmount(() => {
  flushSave();
  unsubLive();
});

// v2.3：订阅 jobs/todos SSE——任务状态推进（awaiting_user/完成）实时刷新进度面板
let liveTimer = null;
const unsubLive = subscribeLive((evt) => {
  if (!props.item?.id) return;
  if (!['jobs', 'todos'].includes(evt.resource)) return;
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    fetchJobs({ item_id: props.item.id })
      .then((res) => { jobs.value = res.jobs || []; })
      .catch(() => {});
  }, 400);
});

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

const activeJob = computed(() => jobs.value.find((j) => ['pending', 'running', 'waiting_local', 'awaiting_user'].includes(j.status)));
// v2.3 确认门：首个待确认任务（Inspector 出「批准/跳过」按钮）
const awaitingJob = computed(() => jobs.value.find((j) => j.status === 'awaiting_user') || null);
const approving = ref(false);
const STEP_ICON = { done: '✓', running: '◐', failed: '✗', pending: '○', skipped: '⏭' };
const SKILL_LABEL = {
  tavily_search: '联网调研',
  browser_screenshot: '网页截图',
  gh_inspect: '仓库检查+Clone',
  gh_search: 'GitHub 搜索',
  agent_task: 'Agent 委派',
};

async function decide(action) {
  if (!awaitingJob.value || approving.value) return;
  approving.value = true;
  try {
    const res = await approveJob(awaitingJob.value.id, action);
    jobs.value = [res.job, ...jobs.value.filter((j) => j.id !== res.job.id)];
    if (action === 'approve') toastSuccess('已批准，Agent 接手执行 🤖');
    else toast('已跳过该步', 'info');
  } catch (e) {
    toastError(e.message);
  } finally {
    approving.value = false;
  }
}

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

/** 可预览的资产：图片直出；v2.3.1 文档类产物（md/pdf/…）走文件链接区 */
const isImgUrl = (url) => /\.(png|jpe?g|webp|gif)$/i.test(url || '');
const previewAssets = computed(() => (props.item.assets || []).filter((a) => a.remote_url && isImgUrl(a.remote_url)));
const fileAssets = computed(() => (props.item.assets || []).filter((a) => a.remote_url && !isImgUrl(a.remote_url)));
const fileIcon = (a) => (/\.pdf$/i.test(a.remote_url) ? '📕' : /\.json|\.csv$/i.test(a.remote_url) ? '📊' : /\.md|\.txt|\.html$/i.test(a.remote_url) ? '📄' : '📦');
const assetName = (a) =>
  a.metadata?.filename ||                              // 上传时的原始文件名（优先）
  (a.prompt && !a.prompt.startsWith('preexec:') ? a.prompt : '') ||  // 非 preexec 的说明文字
  a.remote_url.split('/').pop();                       // 兜底：站内文件名

// ===== v2.3.2 产物内嵌阅读器：Inspector 内渲染 markdown，不开新窗口 =====
const viewer = reactive({ asset: null, html: '', loading: false, error: '' });
const viewerBody = ref(null);

/** 自家 Agent 产物，防御性清洗后交给 marked 渲染（gfm 表格 + 换行转 <br>） */
function renderMd(md) {
  const html = marked.parse(String(md || ''), { breaks: true, gfm: true });
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}

async function toggleViewer(a) {
  if (viewer.asset?.id === a.id) {
    viewer.asset = null;
    return;
  }
  viewer.asset = a;
  viewer.loading = true;
  viewer.error = '';
  closeSelMenu();
  try {
    const res = await fetch(a.remote_url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    viewer.html = renderMd(await res.text());
  } catch (e) {
    viewer.error = `读取失败：${e.message}`;
  }
  viewer.loading = false;
  nextTick(() => {
    // 渲染后的链接一律新窗口打开（不冲掉 InfoStation 页面）
    viewerBody.value?.querySelectorAll('a[href]').forEach((el) => {
      el.target = '_blank';
      el.rel = 'noopener';
    });
  });
}

// ===== v2.3.2 选中感知：划选产物文字 → 浮动菜单（出处 + 一键变要点/TODO/笔记）=====
const selMenu = reactive({ show: false, x: 0, y: 0, text: '', file: '', section: '', below: false });

function closeSelMenu() {
  selMenu.show = false;
}

function sectionOf(node) {
  let el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  while (el && el !== viewerBody.value) {
    if (/^H[1-6]$/.test(el.tagName)) return el.textContent.trim().slice(0, 30);
    el = el.parentElement;
  }
  return '';
}

function onSelect(ev) {
  const sel = window.getSelection();
  const text = sel?.toString().trim() || '';
  if (!text || text.length < 2 || !viewerBody.value?.contains(sel.anchorNode)) {
    closeSelMenu();
    return;
  }
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  selMenu.text = text.slice(0, 300);
  selMenu.file = assetName(viewer.asset || {});
  selMenu.section = sectionOf(sel.anchorNode);
  // fixed 定位用视口坐标：选区在阅读器滚动容器内，window.scrollY 不参与
  selMenu.x = Math.max(150, Math.min(rect.left + rect.width / 2, window.innerWidth - 150));
  const MENU_H = 64;
  selMenu.y = rect.top > MENU_H + 16 ? rect.top - 8 : rect.bottom + 8;
  selMenu.below = !(rect.top > MENU_H + 16);
  selMenu.show = true;
}

async function addAsPoint() {
  try {
    edit.points.push(selMenu.text.slice(0, 200));
    savePoints();
    toastSuccess('已加入要点 ✓');
    closeSelMenu();
    window.getSelection()?.removeAllRanges();
  } catch (e) {
    toastError(e.message);
  }
}

async function addAsTodo() {
  try {
    await createTodo({
      title: selMenu.text.slice(0, 40),
      description: `摘自《${selMenu.file}》${selMenu.section ? ` · ${selMenu.section}` : ''}`,
      source_item_id: props.item.id,
      line: props.item.line,
      topic_id: props.item.topic_id,
      category: props.item.primary_category,
    });
    toastSuccess('已生成 TODO ✓');
    closeSelMenu();
    window.getSelection()?.removeAllRanges();
  } catch (e) {
    toastError(e.message);
  }
}

async function addAsNote() {
  try {
    const src = `📌 摘记（摘自《${selMenu.file}》${selMenu.section ? ` · ${selMenu.section}` : ''}）：${selMenu.text.slice(0, 200)}`;
    const note = `${props.item.agent_note ? props.item.agent_note + '\n\n' : ''}${src}`;
    await patchItem(props.item.id, { agent_note: note.slice(0, 4000) });
    props.item.agent_note = note.slice(0, 4000);
    toastSuccess('已加入卡片笔记 ✓');
    closeSelMenu();
    window.getSelection()?.removeAllRanges();
  } catch (e) {
    toastError(e.message);
  }
}
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

      <!-- v2.2 预处理任务进度：技能步骤逐项点亮 + 失败重跑；v2.3 确认门（批准/跳过） -->
      <section v-if="jobs.length" class="inspector__section">
        <h3>
          🤖 Agent 任务
          <span v-if="awaitingJob" class="inspector__job-live is-awaiting">
            <span class="inspector__pulse is-awaiting" />{{ awaitingJob.current_step || '等你确认' }}
          </span>
          <span v-else-if="activeJob" class="inspector__job-live">
            <span class="inspector__pulse" />{{ activeJob.current_step || '进行中…' }}
          </span>
          <span v-else-if="jobs[0].status === 'failed'" class="timestamp">部分失败</span>
        </h3>
        <div class="inspector__job">
          <div v-for="(l, i) in jobs[0].logs" :key="i" class="inspector__job-step" :class="`is-${l.status}`">
            <span class="inspector__job-icon">{{ STEP_ICON[l.status] || '○' }}</span>
            <span class="inspector__job-name">{{ SKILL_LABEL[l.skill] || l.skill }}</span>
            <span class="timestamp">{{ l.error ? l.error.slice(0, 40) : (l.result?.asset_url ? '已存截图' : '') }}</span>
          </div>
          <div v-for="s in jobs[0].skills_plan.slice(jobs[0].logs.length)" :key="s.skill" class="inspector__job-step is-pending">
            <span class="inspector__job-icon">{{ s.needs_confirm ? '⏸' : '○' }}</span>
            <span class="inspector__job-name">{{ SKILL_LABEL[s.skill] || s.skill }}</span>
            <span class="timestamp">{{ s.needs_confirm ? '待你确认' : s.runtime === 'local' ? '待本地 Agent' : '排队中' }}</span>
          </div>
          <!-- v2.3 确认门：批准放行 / 跳过该步 -->
          <div v-if="awaitingJob" class="inspector__confirm">
            <button class="btn btn--sm inspector__confirm-yes" :disabled="approving" @click="decide('approve')">
              ✅ 批准执行
            </button>
            <button class="btn btn--glass btn--sm" :disabled="approving" @click="decide('skip')">⏭ 跳过</button>
          </div>
          <button v-if="!activeJob" class="btn btn--glass btn--sm inspector__rerun" :disabled="reprunning" @click="rerun">
            {{ reprunning ? '启动中…' : '↻ 重新预处理' }}
          </button>
        </div>
      </section>

      <!-- Agent 资产：截图/生图直出预览；v2.3.1 文档产物（初稿/素材包）文件链接；本地路径给占位 -->
      <section v-if="item.assets?.length" class="inspector__section">
        <h3>📎 资产（{{ item.assets.length }}）</h3>
        <div v-if="previewAssets.length" class="inspector__assets">
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
        </div>
        <div v-if="fileAssets.length" class="inspector__files">
          <a
            v-for="a in fileAssets"
            :key="`file-${a.id}`"
            class="inspector__file"
            :class="{ 'is-active': viewer.asset?.id === a.id }"
            :href="a.remote_url"
            :title="`阅读：${assetName(a)}`"
            @click.prevent="toggleViewer(a)"
          >
            <span class="inspector__file-icon">{{ fileIcon(a) }}</span>
            <span class="inspector__file-name">{{ assetName(a) }}</span>
            <span class="inspector__file-open">{{ viewer.asset?.id === a.id ? '收起 ▴' : '阅读 ▾' }}</span>
          </a>
        </div>
        <!-- v2.3.2 内嵌阅读器：markdown 渲染 + 选中感知（→要点/TODO/笔记） -->
        <div v-if="viewer.asset" class="inspector__viewer">
          <header class="inspector__viewer-head">
            <span>{{ fileIcon(viewer.asset) }} {{ assetName(viewer.asset) }}</span>
            <button class="inspector__viewer-close" title="收起" @click="viewer.asset = null">✕</button>
          </header>
          <div v-if="viewer.loading" class="inspector__viewer-hint">读取中…</div>
          <div v-else-if="viewer.error" class="inspector__viewer-hint">{{ viewer.error }}</div>
          <div
            v-else
            ref="viewerBody"
            class="inspector__md"
            v-html="viewer.html"
            @mouseup="onSelect"
          />
          <footer class="inspector__viewer-hint">划选文字 → 一键添加为要点 / TODO / 笔记</footer>
        </div>
        <div
          v-for="a in (item.assets || []).filter((x) => !x.remote_url)"
          :key="`local-${a.id}`"
          class="inspector__asset inspector__asset--local"
          :title="a.local_path"
        >
          📎 {{ a.asset_type === 'screenshot' ? '截图' : a.asset_type === 'ai_image' ? '生图' : '文件' }}（待上传图床）
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

    <!-- v2.3.2 划选浮动菜单：Teleport 到 body——aside 的 backdrop-filter 会创建 containing block，fixed 会退化成面板内定位 -->
    <Teleport to="body">
      <div
        v-if="selMenu.show"
        class="inspector__selmenu"
        :class="{ 'is-below': selMenu.below }"
        :style="{ left: selMenu.x + 'px', top: selMenu.y + 'px' }"
        @mousedown.prevent
      >
        <div class="inspector__selmenu-src">
          摘自 {{ selMenu.file }}<template v-if="selMenu.section"> · {{ selMenu.section }}</template>
        </div>
        <div class="inspector__selmenu-actions">
          <button title="加入卡片要点" @click="addAsPoint">→ 要点</button>
          <button title="生成一条 TODO（继承卡片线/主题）" @click="addAsTodo">→ TODO</button>
          <button title="追加到卡片笔记" @click="addAsNote">→ 笔记</button>
        </div>
      </div>
    </Teleport>
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
.inspector__job-step.is-skipped { color: var(--text-muted); }
.inspector__job-icon { width: 14px; text-align: center; }
.inspector__job-name { flex: 1; }
.inspector__rerun { align-self: flex-start; margin-top: var(--space-2); }

/* v2.3 确认门：琥珀色高亮 + 批准/跳过按钮组 */
.inspector__job-live.is-awaiting { color: var(--accent-orange); }
.inspector__pulse.is-awaiting {
  background: var(--accent-orange);
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.6);
}
.inspector__confirm {
  display: flex;
  gap: var(--space-4);
  margin-top: var(--space-3);
}
.inspector__confirm-yes {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.28), rgba(16, 185, 129, 0.2));
  border: 1px solid rgba(34, 197, 94, 0.4);
  color: #86efac;
}

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

/* v2.3.1 文档类产物：文件链接行（初稿/素材包等，点击新窗口查看） */
.inspector__files { display: flex; flex-direction: column; gap: var(--space-3); }
.inspector__file {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  background: var(--glass-bg-faint);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  font: var(--font-micro);
  color: var(--text-secondary);
  transition: all var(--transition-fast);
}
.inspector__file:hover {
  color: var(--text-primary);
  border-color: var(--glass-border-hover);
  background: var(--glass-hover);
}
.inspector__file-icon { font-size: 15px; }
.inspector__file-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.inspector__file-open { color: var(--accent-cyan); white-space: nowrap; }
.inspector__file.is-active {
  border-color: rgba(6, 182, 212, 0.4);
  background: rgba(6, 182, 212, 0.08);
}

/* v2.3.2 内嵌阅读器：md 渲染排版 */
.inspector__viewer {
  margin-top: var(--space-4);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--glass-bg-faint);
  overflow: hidden;
}
.inspector__viewer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  font: var(--font-micro);
  color: var(--text-secondary);
  border-bottom: 1px solid var(--glass-border);
}
.inspector__viewer-close {
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  font-size: 12px;
}
.inspector__viewer-close:hover { color: var(--text-primary); background: var(--glass-hover); }
.inspector__viewer-hint {
  padding: var(--space-3) var(--space-5);
  font: var(--font-micro);
  color: var(--text-muted);
}
.inspector__md {
  max-height: 480px;
  overflow-y: auto;
  padding: var(--space-5);
  font: var(--font-body);
  color: var(--text-primary);
  line-height: 1.65;
}
.inspector__md :deep(h1) { font: var(--font-h3); margin: var(--space-6) 0 var(--space-3); }
.inspector__md :deep(h1:first-child) { margin-top: 0; }
.inspector__md :deep(h2) { font: var(--font-h4); margin: var(--space-5) 0 var(--space-3); }
.inspector__md :deep(h3), .inspector__md :deep(h4) { font: var(--font-body); font-weight: 650; margin: var(--space-4) 0 var(--space-2); }
.inspector__md :deep(p) { margin: var(--space-3) 0; }
.inspector__md :deep(ul), .inspector__md :deep(ol) { margin: var(--space-3) 0; padding-left: 1.4em; }
.inspector__md :deep(li) { margin: var(--space-1) 0; }
.inspector__md :deep(blockquote) {
  margin: var(--space-4) 0;
  padding: var(--space-2) var(--space-4);
  border-left: 3px solid var(--accent-cyan);
  color: var(--text-secondary);
  background: rgba(6, 182, 212, 0.05);
  border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
}
.inspector__md :deep(code) {
  font-family: ui-monospace, monospace;
  font-size: 0.9em;
  padding: 1px 5px;
  border-radius: var(--radius-xs);
  background: rgba(148, 163, 184, 0.15);
}
.inspector__md :deep(pre) { padding: var(--space-4); overflow-x: auto; border-radius: var(--radius-sm); background: rgba(148, 163, 184, 0.1); }
.inspector__md :deep(pre code) { padding: 0; background: none; }
.inspector__md :deep(table) { border-collapse: collapse; margin: var(--space-4) 0; width: 100%; font-size: 0.88em; }
.inspector__md :deep(th), .inspector__md :deep(td) {
  border: 1px solid var(--glass-border);
  padding: var(--space-2) var(--space-3);
  text-align: left;
}
.inspector__md :deep(th) { background: rgba(148, 163, 184, 0.1); font-weight: 600; }
.inspector__md :deep(hr) { border: none; border-top: 1px solid var(--glass-border); margin: var(--space-5) 0; }
.inspector__md :deep(a) { color: var(--accent-cyan); }
.inspector__md ::selection { background: rgba(6, 182, 212, 0.3); }

/* v2.3.2 划选浮动菜单：fixed 视口定位，选区上方弹出（贴顶时翻到下方） */
.inspector__selmenu {
  position: fixed;
  z-index: 60;
  transform: translate(-50%, -100%);
  background: rgba(15, 23, 42, 0.92);
  backdrop-filter: blur(12px);
  border: 1px solid var(--glass-border-hover);
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  min-width: 200px;
}
.inspector__selmenu.is-below { transform: translate(-50%, 0); }
.inspector__selmenu-src {
  font: var(--font-micro);
  color: #94a3b8;
  margin-bottom: var(--space-2);
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inspector__selmenu-actions { display: flex; gap: var(--space-2); }
.inspector__selmenu-actions button {
  padding: 4px 10px;
  border-radius: var(--radius-xs);
  font: var(--font-micro);
  color: #e2e8f0;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  white-space: nowrap;
  transition: all var(--transition-fast);
}
.inspector__selmenu-actions button:hover {
  background: rgba(6, 182, 212, 0.25);
  border-color: rgba(6, 182, 212, 0.5);
  color: #fff;
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
