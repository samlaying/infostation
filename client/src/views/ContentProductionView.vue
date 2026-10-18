<script setup>
// ===== 内容生产（自媒体线）· v2.1 状态机流水线 =====
// MECE：本视图只管 media 线。选题卡是流水线母卡，内嵌工序与资产，四状态各配唯一主 CTA：
//   A 无工序 → ⚡ 拆解工序（生成模板子工序）
//   B 工序进行中 → 勾工序 + 🖼 挂载图片资产（截图/生图入 assets 表）
//   C 工序齐备 → 📦 生成发布包（写 posts 表，带文案+配图引用）
//   D 发布包待发 → 📋 复制文案 / ✅ 标为已发布（回执链接）
import { ref, computed, onMounted } from 'vue';
import {
  fetchItems, fetchItem, fetchTodos, patchTodo, patchItem, createTodo,
  fetchAssets, createAsset, fetchPosts, createPost, patchPost, processInput,
} from '../api';
import { LINE_MAP, POST_PLATFORM_MAP, POST_STATUS_MAP, timeAgo } from '../constants';
import ItemDetailModal from '../components/ItemDetailModal.vue';
import EmptyState from '../components/EmptyState.vue';
import { toastError, toastSuccess } from '../stores/toast';
import { useLiveReload } from '../api/live';

const ideas = ref([]);          // 选题卡（form=idea）
const posts = ref([]);          // 发布包（posts 表）
const workflows = ref([]);      // 待推进工序（line=media pending）
const doneFlows = ref([]);      // 已完成工序（计数用）
const assetsByItem = ref({});   // item_id → assets[]
const loading = ref(true);
const detailItem = ref(null);
const tab = ref('pipeline');    // pipeline | packages
const addingFlowFor = ref(null); // 展开内联添加工序的选题 id
const newFlowTitle = ref('');

async function load() {
  loading.value = true;
  try {
    const [ideaRes, postRes, wfRes, doneRes, assetRes] = await Promise.all([
      fetchItems({ form: 'idea', line: 'media', page_size: 60 }),
      fetchPosts({}),
      fetchTodos({ view: 'pending', line: 'media' }),
      fetchTodos({ view: 'done', line: 'media' }),
      fetchAssets({}),
    ]);
    ideas.value = ideaRes.items || [];
    posts.value = (postRes.posts || []).slice().sort((a, b) => b.id - a.id);
    workflows.value = wfRes.todos || [];
    doneFlows.value = doneRes.todos || [];
    const map = {};
    for (const a of assetRes.assets || []) (map[a.item_id] ||= []).push(a);
    assetsByItem.value = map;
  } catch (e) {
    toastError(e.message);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// SSE：任何一环变更后自动重拉
useLiveReload(load, ['items', 'todos', 'posts', 'assets']);

const pendingByItem = computed(() => groupBy(workflows.value));
const doneByItem = computed(() => groupBy(doneFlows.value));
function groupBy(list) {
  const m = {};
  for (const t of list) (m[t.source_item_id] ||= []).push(t);
  return m;
}
const flowsOf = (it) => [...(pendingByItem.value[it.id] || []), ...(doneByItem.value[it.id] || [])];
const pendingOf = (it) => pendingByItem.value[it.id] || [];
const assetsOf = (it) => assetsByItem.value[it.id] || [];

// 状态机：A 无工序 / B 工序进行中 / C 工序齐备（可打包）
function stageOf(it) {
  const pending = pendingOf(it).length;
  const total = flowsOf(it).length;
  if (total === 0) return 'A';
  if (pending > 0) return 'B';
  return 'C';
}

// ---- 状态 A：拆解工序（模板三步：实测截图 / 要点整理 / 初稿） ----
async function bootstrapFlows(it) {
  const tpl = [
    '实测并截图（关键步骤 + 结果）',
    '整理要点对比（给帖子搭骨架）',
    '写初稿（带 emoji 的平台文案）',
  ];
  try {
    await Promise.all(tpl.map((title) =>
      createTodo({ title, line: 'media', source_item_id: it.id, topic_id: it.topic_id || undefined })
    ));
    toastSuccess(`已拆解 ${tpl.length} 道工序，逐个推进吧`);
  } catch (e) {
    toastError(e.message);
  }
}

// ---- 工序勾选 ----
async function toggleFlow(w) {
  try {
    const next = w.status === 'done' ? 'pending' : 'done';
    await patchTodo(w.id, { status: next });
    if (next === 'done') toastSuccess('工序已完成 ✓');
    await load();
  } catch (e) {
    toastError(e.message);
  }
}

function startAddFlow(it) {
  addingFlowFor.value = it.id;
  newFlowTitle.value = '';
}
async function addFlow(it) {
  const title = newFlowTitle.value.trim();
  if (!title) return;
  try {
    await createTodo({ title, line: 'media', source_item_id: it.id, topic_id: it.topic_id || undefined });
    newFlowTitle.value = '';
    addingFlowFor.value = null;
    toastSuccess('工序已添加');
  } catch (e) {
    toastError(e.message);
  }
}

// ---- 状态 B：挂载图片资产（本地 Agent 截图/生图后登记，或直接贴图床 URL） ----
async function attachAsset(it, presetType = 'upload') {
  const url = prompt('贴入图片 URL（本地 Agent 截图/生图上传图床后的链接）：');
  if (!url || !/^https?:\/\//.test(url.trim())) return;
  try {
    await createAsset({ item_id: it.id, asset_type: presetType, remote_url: url.trim() });
    toastSuccess('资产已挂载 🖼');
  } catch (e) {
    toastError(e.message);
  }
}

// ---- 状态 C：一键生成发布包（posts 表，小红书默认） ----
async function makePackage(it) {
  try {
    const body = [
      it.summary,
      ...(it.key_points || []).map((k, i) => `${i + 1}. ${k}`),
    ].join('\n\n');
    await createPost({
      source_item_id: it.id,
      topic_id: it.topic_id || undefined,
      platform: 'xiaohongshu',
      title: it.title,
      content_body: body,
      asset_ids: assetsOf(it).map((a) => a.id),
    });
    toastSuccess('发布包已生成，去「发布包」检查文案 📦');
    tab.value = 'packages';
  } catch (e) {
    toastError(e.message);
  }
}

// ---- 状态 D：发布包操作 ----
async function copyPost(p) {
  const text = `${p.title}\n\n${p.content_body}`;
  try {
    await navigator.clipboard.writeText(text);
    toastSuccess('文案已复制 📋');
  } catch {
    toastError('复制失败（浏览器未授权剪贴板）');
  }
}

async function publishPost(p) {
  const url = prompt('发布成功后的回执链接（可留空）：') || '';
  try {
    await patchPost(p.id, { status: 'published', published_url: url || undefined });
    toastSuccess('已盖章「已发布」🚀');
  } catch (e) {
    toastError(e.message);
  }
}

async function openDetail(item) {
  detailItem.value = await fetchItem(item.id);
}

// 快速新建选题（「选题｜」前缀 → 后端自动识别为 idea 形态，不再打 #选题 标签）
const newTopic = ref('');
const creating = ref(false);
async function createTopic() {
  const title = newTopic.value.trim();
  if (!title) return;
  creating.value = true;
  try {
    await processInput({
      content: `选题｜${title}`,
      line: 'media',
      preferred_category: 'media',
      user_note: `选题库｜来源=手动录入｜${new Date().toISOString().slice(0, 10)}`,
    });
    newTopic.value = '';
    toastSuccess('选题已加入流水线');
  } catch (e) {
    toastError(e.message);
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <div class="content-view">
    <header class="content-view__head glass-panel">
      <div class="content-view__head-title">
        <span class="content-view__icon">{{ LINE_MAP.media.icon }}</span>
        <div>
          <h1>内容生产</h1>
          <p class="content-view__sub">{{ LINE_MAP.media.desc }}</p>
        </div>
      </div>
      <div class="content-view__head-stats">
        <span><b>{{ ideas.length }}</b> 选题</span>
        <span><b>{{ workflows.length }}</b> 待推工序</span>
        <span><b>{{ posts.filter((p) => p.status !== 'published').length }}</b> 待发帖</span>
      </div>
    </header>

    <!-- 快速新建选题 -->
    <div class="glass-panel content-view__create">
      <input
        v-model="newTopic"
        class="glass-input content-view__create-input"
        placeholder="记一个选题（如：AI 副业的过程透明化）…"
        @keydown.enter="createTopic"
      />
      <button class="btn btn--primary" :disabled="!newTopic.trim() || creating" @click="createTopic">
        {{ creating ? '创建中…' : '＋ 新建选题' }}
      </button>
    </div>

    <!-- 流水线进度条（只读状态灯）+ 两个工作区 Tab -->
    <div class="content-view__pipebar">
      <div class="pipebar" aria-hidden="true">
        <span class="pipebar__node is-on">💡 选题 {{ ideas.length }}</span>
        <span class="pipebar__link" />
        <span class="pipebar__node" :class="{ 'is-on': workflows.length }">🔨 工序 {{ workflows.length }}</span>
        <span class="pipebar__link" />
        <span class="pipebar__node" :class="{ 'is-on': posts.length }">📦 发布包 {{ posts.length }}</span>
      </div>
      <div class="content-view__tabs">
        <button class="stepper__step" :class="{ 'is-active': tab === 'pipeline' }" @click="tab = 'pipeline'">💡 选题流水线</button>
        <button class="stepper__step" :class="{ 'is-active': tab === 'packages' }" @click="tab = 'packages'">📦 发布包</button>
      </div>
    </div>

    <!-- ===== 选题流水线：母子一体化 Pipeline Card ===== -->
    <template v-if="tab === 'pipeline'">
      <div v-if="loading" class="content-view__loading"><span class="spinner" /> 加载中…</div>
      <div v-else-if="ideas.length" class="pipeline">
        <article v-for="it in ideas" :key="it.id" class="pipeline__card glass-panel">
          <!-- 母卡：选题信息 -->
          <header class="pipeline__head" @click="openDetail(it)">
            <div class="pipeline__role">
              💡 选题
              <span v-if="it.topic_name" class="pipeline__topic">📁 {{ it.topic_name }}</span>
              <span class="pipeline__stage" :data-stage="stageOf(it)">
                {{ stageOf(it) === 'A' ? '待拆解' : stageOf(it) === 'B' ? '制作中' : '可打包' }}
              </span>
            </div>
            <h3 class="pipeline__title">{{ it.title }}</h3>
            <p class="pipeline__summary">{{ it.summary }}</p>
          </header>

          <!-- 资产槽：Agent 截图 / 生图缩略图 + 挂载入口 -->
          <div class="pipeline__assets">
            <template v-for="a in assetsOf(it).slice(0, 6)" :key="a.id">
              <a v-if="a.remote_url" class="pipeline__asset" :href="a.remote_url" target="_blank" rel="noopener" :title="a.prompt || a.asset_type">
                <img :src="a.remote_url" loading="lazy" alt="" />
              </a>
              <span v-else class="pipeline__asset pipeline__asset--local" :title="a.local_path">📎</span>
            </template>
            <button class="pipeline__asset-add" title="挂载截图/生图（贴图床 URL 入 assets 表）" @click="attachAsset(it, 'upload')">＋ 图片</button>
          </div>

          <!-- 子列表：内嵌工序（可直接勾） -->
          <div class="pipeline__flows">
            <div v-for="w in pendingOf(it)" :key="w.id" class="pipeline__flow">
              <button class="pipeline__check" title="完成工序" @click="toggleFlow(w)">○</button>
              <span class="pipeline__flow-title">{{ w.title }}</span>
              <span class="priority-dot" :class="`priority-dot--${w.priority}`" />
            </div>
            <div v-for="w in (doneByItem[it.id] || [])" :key="`d-${w.id}`" class="pipeline__flow is-done">
              <span class="pipeline__check is-checked">✓</span>
              <span class="pipeline__flow-title">{{ w.title }}</span>
            </div>

            <!-- 内联添加工序 -->
            <div v-if="addingFlowFor === it.id" class="pipeline__addflow">
              <input
                v-model="newFlowTitle"
                class="glass-input pipeline__addflow-input"
                placeholder="新工序（如：截一张对比表格图）"
                autofocus
                @keydown.enter="addFlow(it)"
                @keydown.esc="addingFlowFor = null"
              />
              <button class="btn btn--glass btn--sm" @click="addFlow(it)">加入</button>
            </div>
            <button v-else class="pipeline__flow-add" @click="startAddFlow(it)">＋ 添加工序</button>
          </div>

          <!-- 状态机 CTA：任何时刻只有一个高亮主按钮 -->
          <footer class="pipeline__cta">
            <template v-if="stageOf(it) === 'A'">
              <button class="btn btn--primary pipeline__btn" @click="bootstrapFlows(it)">⚡ 让 Agent 拆解工序</button>
            </template>
            <template v-else-if="stageOf(it) === 'B'">
              <span class="pipeline__hint">工序 {{ (doneByItem[it.id] || []).length }}/{{ flowsOf(it).length }} · 配图 {{ assetsOf(it).length }} 张</span>
              <button class="btn btn--glass pipeline__btn" @click="attachAsset(it, 'ai_image')">🖼 挂载配图</button>
              <button class="btn btn--glass pipeline__btn" :disabled="!assetsOf(it).length" title="工序勾完后可打包" @click="makePackage(it)">📦 生成发布包</button>
            </template>
            <template v-else>
              <span class="pipeline__hint">✅ 工序全部完成 · 配图 {{ assetsOf(it).length }} 张</span>
              <button class="btn btn--primary pipeline__btn" @click="makePackage(it)">📦 一键生成发布包 →</button>
            </template>
          </footer>
        </article>
      </div>
      <EmptyState v-else icon="💡" title="选题库还是空的" desc="在上方记一个选题，或从信息库把跑通的经验卡「转为选题」" />
    </template>

    <!-- ===== 发布包：posts 表（仿真社媒待发帖） ===== -->
    <template v-else>
      <div v-if="loading" class="content-view__loading"><span class="spinner" /> 加载中…</div>
      <div v-else-if="posts.length" class="content-view__grid">
        <article
          v-for="p in posts"
          :key="p.id"
          class="pack glass-card glass-card--hover"
          :class="{ 'pack--published': p.status === 'published' }"
        >
          <div class="pack__strip" aria-hidden="true" />
          <div class="pack__role">
            {{ POST_PLATFORM_MAP[p.platform]?.icon }} {{ POST_PLATFORM_MAP[p.platform]?.label || p.platform }}
            · {{ POST_STATUS_MAP[p.status] || p.status }}
            <span v-if="p.status === 'published'" class="pack__stamp">PUBLISHED</span>
          </div>
          <h3 class="pack__title">{{ p.title }}</h3>
          <p class="pack__body">{{ p.content_body }}</p>
          <div class="pack__meta">
            <span class="timestamp">🖼 {{ (p.asset_ids || []).length }} 配图 · {{ timeAgo(p.created_at) }}</span>
            <a v-if="p.published_url" class="pack__receipt" :href="p.published_url" target="_blank" rel="noopener">回执 ↗</a>
          </div>
          <footer v-if="p.status !== 'published'" class="pack__actions">
            <button class="btn btn--glass btn--sm" @click="copyPost(p)">📋 复制文案</button>
            <button class="btn btn--primary btn--sm" @click="publishPost(p)">🚀 标为已发布</button>
          </footer>
          <footer v-else class="pack__actions">
            <button class="btn btn--glass btn--sm" @click="copyPost(p)">📋 复制文案</button>
          </footer>
        </article>
      </div>
      <EmptyState v-else icon="📦" title="还没有发布包" desc="在选题流水线里把工序勾完，点「生成发布包」就会出现在这里" />
    </template>

    <ItemDetailModal
      v-if="detailItem"
      :item="detailItem"
      @close="detailItem = null"
      @updated="load"
      @deleted="detailItem = null; load()"
      @open-related="openDetail({ id: $event })"
    />
  </div>
</template>

<style scoped>
.content-view { display: flex; flex-direction: column; gap: var(--space-8); }
.content-view__loading {
  display: flex; align-items: center; justify-content: center; gap: var(--space-4);
  padding: var(--space-14); color: var(--text-secondary); font: var(--font-secondary);
}

.content-view__head {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--space-7); padding: var(--space-9) var(--space-11); flex-wrap: wrap;
}
.content-view__head-title { display: flex; align-items: center; gap: var(--space-6); }
.content-view__icon { font-size: 28px; }
.content-view__head-title h1 { font: var(--font-h2); color: var(--text-primary); }
.content-view__sub { font: var(--font-caption); color: var(--text-secondary); margin-top: 2px; }
.content-view__head-stats { display: flex; gap: var(--space-8); font: var(--font-caption); color: var(--text-secondary); }
.content-view__head-stats b { color: var(--line-media); font: var(--font-h3); }

.content-view__create { display: flex; gap: var(--space-4); padding: var(--space-7); }
.content-view__create-input { flex: 1; }

/* ===== 流水线进度条 + 工作区切换 ===== */
.content-view__pipebar {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-6); flex-wrap: wrap;
}
.pipebar { display: flex; align-items: center; gap: var(--space-4); }
.pipebar__node {
  font: var(--font-caption); color: var(--text-muted);
  padding: 5px 14px; border-radius: var(--radius-full);
  border: 1px dashed var(--glass-border);
  white-space: nowrap; transition: all var(--transition-fast);
}
.pipebar__node.is-on {
  color: var(--line-media); border-style: solid; border-color: color-mix(in srgb, var(--line-media) 45%, transparent);
  background: color-mix(in srgb, var(--line-media) 8%, transparent);
}
.pipebar__link {
  width: 22px; height: 1.5px;
  background: linear-gradient(90deg, var(--glass-border-hover), color-mix(in srgb, var(--line-media) 55%, transparent));
}
.content-view__tabs { display: flex; gap: var(--space-4); }

.stepper__step {
  display: inline-flex; align-items: center; gap: var(--space-3);
  padding: 10px 20px; font: var(--font-secondary); font-weight: 600;
  color: var(--text-secondary); background: var(--glass-bg);
  border: 1px solid var(--glass-border); border-radius: var(--radius-full);
  backdrop-filter: blur(var(--blur-base)); -webkit-backdrop-filter: blur(var(--blur-base));
  transition: all var(--transition-fast); white-space: nowrap;
}
.stepper__step:hover { color: var(--text-primary); border-color: var(--glass-border-hover); }
.stepper__step.is-active {
  color: var(--text-primary); background: var(--glass-bg-strong);
  border-color: color-mix(in srgb, var(--line-media) 45%, transparent);
  box-shadow: 0 2px 12px rgba(234, 88, 12, 0.14), inset 0 1px 0 var(--glass-highlight);
}

/* ===== Pipeline Card：母卡 + 资产槽 + 内嵌工序 + CTA ===== */
.pipeline { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: var(--space-7); }
.pipeline__card {
  display: flex; flex-direction: column; gap: var(--space-5);
  padding: var(--space-9);
  border-top: 2px solid color-mix(in srgb, var(--line-media) 55%, transparent);
}
.pipeline__head { cursor: pointer; display: flex; flex-direction: column; gap: var(--space-3); }
.pipeline__role { font: var(--font-micro); color: var(--accent-purple); display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.pipeline__topic {
  color: var(--accent-blue); border: 1px solid rgba(37, 99, 235, 0.3);
  background: rgba(37, 99, 235, 0.07); padding: 1px 9px; border-radius: var(--radius-full);
}
.pipeline__stage { padding: 1px 9px; border-radius: var(--radius-full); border: 1px solid var(--glass-border); color: var(--text-secondary); }
.pipeline__stage[data-stage="A"] { color: var(--accent-orange); border-color: rgba(251, 146, 60, 0.4); }
.pipeline__stage[data-stage="B"] { color: var(--accent-cyan); border-color: rgba(6, 182, 212, 0.4); }
.pipeline__stage[data-stage="C"] { color: var(--accent-green); border-color: rgba(5, 150, 105, 0.4); }
.pipeline__title { font: var(--font-h3); color: var(--text-primary); line-height: 1.4; }
.pipeline__summary {
  font: var(--font-caption); color: var(--text-secondary); line-height: 1.6;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}

/* 资产槽 */
.pipeline__assets { display: flex; gap: var(--space-3); overflow-x: auto; padding-bottom: 2px; }
.pipeline__asset {
  width: 72px; height: 54px; flex-shrink: 0; border-radius: var(--radius-sm);
  overflow: hidden; border: 1px solid var(--glass-border);
  display: flex; align-items: center; justify-content: center; font-size: 16px;
}
.pipeline__asset img { width: 100%; height: 100%; object-fit: cover; }
.pipeline__asset--local { border-style: dashed; color: var(--text-muted); }
.pipeline__asset-add {
  width: 72px; height: 54px; flex-shrink: 0; border-radius: var(--radius-sm);
  border: 1.5px dashed var(--glass-border-hover); color: var(--text-muted);
  font: var(--font-micro); transition: all var(--transition-fast);
}
.pipeline__asset-add:hover { color: var(--line-media); border-color: var(--line-media); background: color-mix(in srgb, var(--line-media) 8%, transparent); }

/* 内嵌工序 */
.pipeline__flows { display: flex; flex-direction: column; gap: var(--space-2); }
.pipeline__flow {
  display: flex; align-items: center; gap: var(--space-4);
  padding: var(--space-3) var(--space-5); background: var(--glass-bg-faint);
  border: 1px solid transparent; border-radius: var(--radius-sm);
  transition: border-color var(--transition-fast), background var(--transition-fast);
}
.pipeline__flow:hover { border-color: var(--glass-border); background: var(--glass-hover); }
.pipeline__flow.is-done { opacity: 0.55; }
.pipeline__flow.is-done .pipeline__flow-title { text-decoration: line-through; }
.pipeline__check {
  width: 19px; height: 19px; min-width: 19px; border-radius: 50%;
  border: 1.5px solid var(--glass-border-hover); background: var(--bg-secondary);
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; color: transparent; transition: all var(--transition-fast);
}
.pipeline__check:hover {
  border-color: var(--accent-green); color: var(--accent-green);
  background: rgba(5, 150, 105, 0.12); box-shadow: 0 0 8px rgba(5, 150, 105, 0.25);
}
.pipeline__check.is-checked { border-color: var(--accent-green); color: var(--accent-green); background: rgba(5, 150, 105, 0.1); cursor: default; }
.pipeline__flow-title { flex: 1; font: var(--font-secondary); color: var(--text-primary); }
.pipeline__flow-add {
  align-self: flex-start; font: var(--font-micro); color: var(--text-muted);
  padding: var(--space-2) var(--space-4); border: 1px dashed var(--glass-border);
  border-radius: var(--radius-sm); transition: all var(--transition-fast);
}
.pipeline__flow-add:hover { color: var(--line-media); border-color: var(--line-media); }
.pipeline__addflow { display: flex; gap: var(--space-3); }
.pipeline__addflow-input { flex: 1; padding: 7px 12px; font: var(--font-caption); }

/* CTA 行 */
.pipeline__cta {
  display: flex; align-items: center; justify-content: flex-end; gap: var(--space-4);
  padding-top: var(--space-4); border-top: 1px solid var(--glass-border); flex-wrap: wrap;
}
.pipeline__hint { font: var(--font-micro); color: var(--text-secondary); margin-right: auto; }

/* ===== 发布包 ===== */
.content-view__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: var(--space-7); }
.pack {
  position: relative; overflow: hidden;
  display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-8); text-align: left;
}
.pack__strip {
  height: 4px; margin: calc(-1 * var(--space-8)) calc(-1 * var(--space-8)) var(--space-6);
  background: var(--gradient-media); opacity: 0.9;
}
.pack--published { opacity: 0.6; }
.pack--published .pack__strip { background: var(--glass-border); }
.pack__role { font: var(--font-micro); color: var(--line-media); display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.pack__stamp {
  margin-left: auto; font: var(--font-micro); font-weight: 700; letter-spacing: 1.5px;
  color: var(--accent-green);
  border: 2px solid color-mix(in srgb, var(--accent-green) 55%, transparent);
  background: rgba(5, 150, 105, 0.1); padding: 2px 10px; border-radius: var(--radius-full);
  transform: rotate(-6deg); box-shadow: 0 0 12px rgba(5, 150, 105, 0.2);
}
.pack__title { font: var(--font-h3); color: var(--text-primary); line-height: 1.4; }
.pack__body {
  font: var(--font-caption); color: var(--text-secondary); line-height: 1.6; flex: 1;
  display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden;
  white-space: pre-wrap;
}
.pack__meta { display: flex; align-items: center; justify-content: space-between; }
.pack__receipt { font: var(--font-caption); color: var(--accent-cyan); text-decoration: none; }
.pack__receipt:hover { text-decoration: underline; }
.pack__actions { display: flex; gap: var(--space-4); padding-top: var(--space-3); border-top: 1px solid var(--glass-border); }

@media (max-width: 768px) {
  .pipeline { grid-template-columns: 1fr; }
}
</style>
