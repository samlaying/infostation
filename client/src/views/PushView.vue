<script setup>
// ===== 主动推动（v2.5）=====
// 这一版补的是体系里缺的一层：之前全是「任务驱动」（等你说要做什么），
// 缺「浸泡驱动」（系统主动说今天该看什么）。
//
// 三个来源统一成一张卡片流：
//   discover 外部发现（AIHOT 精选，ego-lite/skills/aihot 同一接口）
//   item/topic 库内再发现（久未推进的卡片与主题）
//   eyewash 洗眼睛（10 站轮换，浸泡层，永远置顶）
// 采纳只返回"下一步动作"，真正的落库仍走既有 process / todos 流水线。
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { fetchPush, generatePush, acceptPush, dismissPush, processInput } from '../api';
import EmptyState from '../components/EmptyState.vue';
import { toastError, toastSuccess } from '../stores/toast';
import { useLiveReload } from '../api/live';

const router = useRouter();
const suggestions = ref([]);
const doneList = ref([]);
const eyewash = ref(null);
const loading = ref(true);
const generating = ref(false);
const acting = ref(null);
const showDone = ref(false);

const KIND_MAP = {
  eyewash: { icon: '👁', label: '洗眼睛', tone: 'eyewash' },
  discover: { icon: '🌐', label: '外部发现', tone: 'discover' },
  item: { icon: '📥', label: '库里这张', tone: 'item' },
  topic: { icon: '📁', label: '主题推进', tone: 'topic' },
};

// 今日一句的草稿（本地暂存，不进数据库——它属于训练日志，不属于 InfoStation）
const todayLine = ref('');

async function load() {
  loading.value = true;
  try {
    const [res, doneRes] = await Promise.all([
      fetchPush({ status: 'new' }),
      fetchPush({ status: 'accepted', limit: 10 }).catch(() => ({ suggestions: [] })),
    ]);
    suggestions.value = res.suggestions || [];
    eyewash.value = res.eyewash || null;
    doneList.value = doneRes.suggestions || [];
  } catch (e) {
    toastError(e.message);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
useLiveReload(load, ['push', 'items', 'todos']);

const eyewashCard = computed(() => suggestions.value.find((s) => s.kind === 'eyewash') || null);
const feed = computed(() => suggestions.value.filter((s) => s.kind !== 'eyewash'));

async function regenerate() {
  if (generating.value) return;
  generating.value = true;
  try {
    const res = await generatePush(true);
    if (res.skipped) toastSuccess('今天已经有推荐了，先把手上的看完');
    else toastSuccess(`新推荐 ${res.created} 条`);
    await load();
  } catch (e) {
    toastError(e.message);
  } finally {
    generating.value = false;
  }
}

async function dismiss(s) {
  acting.value = s.id;
  try {
    await dismissPush(s.id);
    suggestions.value = suggestions.value.filter((x) => x.id !== s.id);
  } catch (e) {
    toastError(e.message);
  } finally {
    acting.value = null;
  }
}

// 采纳：按建议类型分派到既有能力，不新建一条并行链路
async function accept(s) {
  if (acting.value) return;
  acting.value = s.id;
  try {
    const { action } = await acceptPush(s.id);
    suggestions.value = suggestions.value.filter((x) => x.id !== s.id);

    if (!action) {
      toastSuccess('已标记处理');
      return;
    }
    if (action.type === 'process') {
      await processInput({
        content: action.content,
        line: action.line || 'trial',
        user_note: action.user_note || '',
      });
      toastSuccess('已入库并交给 Agent 处理，去信息库看结果 📥');
      router.push('/knowledge');
    } else if (action.type === 'open_item') {
      router.push('/knowledge');
      toastSuccess('去信息库找到它继续推进');
    } else if (action.type === 'open_topic') {
      router.push('/todos');
      toastSuccess('去 TODO 面板按主题推进');
    } else if (action.type === 'open_url') {
      window.open(action.url, '_blank', 'noopener');
      toastSuccess('已打开今日浸泡站 👁');
    }
  } catch (e) {
    toastError(e.message);
  } finally {
    acting.value = null;
  }
}

function openStation(url) {
  if (url) window.open(url, '_blank', 'noopener');
}
</script>

<template>
  <div class="push-view">
    <header class="push-view__head glass-panel">
      <div class="push-view__head-title">
        <span class="push-view__icon">🧭</span>
        <div>
          <h1>主动推动</h1>
          <p class="push-view__sub">不等你开口——今天该看什么、哪张卡该动了</p>
        </div>
      </div>
      <div class="push-view__actions">
        <button class="btn btn--primary" :disabled="generating" @click="regenerate">
          {{ generating ? '生成中…' : '🔄 重新看看' }}
        </button>
      </div>
    </header>

    <!-- 洗眼睛：浸泡层，永远置顶 -->
    <section v-if="eyewashCard" class="eyewash glass-panel">
      <div class="eyewash__head">
        <span class="eyewash__badge">👁 D0 浸泡层</span>
        <span class="eyewash__day" v-if="eyewash">
          今日主站 · 破圈 {{ eyewash.edge?.name }}
        </span>
      </div>
      <h2 class="eyewash__title">{{ eyewashCard.title }}</h2>
      <p class="eyewash__reason">{{ eyewashCard.reason }}</p>

      <div class="eyewash__ask">
        <span class="eyewash__ask-label">唯一动作</span>
        <p>{{ eyewashCard.hook }}</p>
      </div>

      <div class="eyewash__row">
        <button class="btn btn--glass btn--sm" @click="openStation(eyewashCard.payload?.station_url)">
          ↗ 打开 {{ eyewashCard.payload?.station_name }}
        </button>
        <button
          v-if="eyewashCard.payload?.edge_url"
          class="btn btn--glass btn--sm"
          @click="openStation(eyewashCard.payload?.edge_url)"
        >↗ 破圈 {{ eyewashCard.payload?.edge_name }}</button>
        <button class="btn btn--primary btn--sm" :disabled="acting === eyewashCard.id" @click="accept(eyewashCard)">
          今天泡了
        </button>
        <button class="btn btn--glass btn--sm" @click="dismiss(eyewashCard)">今天跳过</button>
      </div>

      <div class="eyewash__line">
        <label class="eyewash__line-label">今日一句（≤30 字，必须说清为什么心动）</label>
        <input
          v-model="todayLine"
          class="glass-input eyewash__line-input"
          placeholder="如：红色只占 5%，越少越响"
          maxlength="60"
        />
        <span class="eyewash__line-hint">
          「好看 / 高级 / 有感觉」不算——换成能复现你判断依据的话
        </span>
      </div>
    </section>

    <!-- 推荐流 -->
    <div v-if="loading" class="push-view__loading"><span class="spinner" /> 加载中…</div>
    <div v-else-if="feed.length" class="push-feed">
      <article
        v-for="s in feed"
        :key="s.id"
        class="push-card glass-card glass-card--hover"
        :data-kind="s.kind"
      >
        <div class="push-card__role">
          <span class="push-card__icon">{{ KIND_MAP[s.kind]?.icon || '✨' }}</span>
          <span>{{ KIND_MAP[s.kind]?.label || s.kind }}</span>
          <span v-if="s.payload?.topic_name" class="push-card__topic">📁 {{ s.payload.topic_name }}</span>
        </div>
        <h3 class="push-card__title">{{ s.title }}</h3>
        <p class="push-card__reason"><b>为什么是现在</b>{{ s.reason }}</p>
        <p v-if="s.hook" class="push-card__hook">👉 {{ s.hook }}</p>
        <footer class="push-card__actions">
          <button class="btn btn--primary btn--sm" :disabled="acting === s.id" @click="accept(s)">
            {{ s.kind === 'discover' ? '📥 收进信息库' : s.kind === 'topic' ? '去推进' : '看看这张' }}
          </button>
          <button class="btn btn--glass btn--sm" :disabled="acting === s.id" @click="dismiss(s)">不感兴趣</button>
          <a
            v-if="s.payload?.url"
            class="push-card__src"
            :href="s.payload.url"
            target="_blank"
            rel="noopener"
          >原文 ↗</a>
        </footer>
      </article>
    </div>
    <EmptyState
      v-else
      icon="🧭"
      title="今天没有新推荐"
      desc="点右上「重新看看」让 Agent 再扫一遍外部资讯和库里的卡"
    />

    <!-- 已采纳（轻量记录，不占主视线） -->
    <details v-if="doneList.length" class="push-done glass-panel">
      <summary>已采纳 {{ doneList.length }} 条</summary>
      <ul>
        <li v-for="d in doneList" :key="d.id">
          <span class="push-done__kind">{{ KIND_MAP[d.kind]?.icon }}</span>
          {{ d.title }}
        </li>
      </ul>
    </details>
  </div>
</template>

<style scoped>
.push-view { display: flex; flex-direction: column; gap: var(--space-7); padding-bottom: var(--space-10); }

.push-view__head {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-6);
  padding: var(--space-7) var(--space-8);
}
.push-view__head-title { display: flex; align-items: center; gap: var(--space-5); }
.push-view__icon { font-size: 30px; }
.push-view__head h1 { font: var(--font-h2); margin: 0; }
.push-view__sub { font: var(--font-body-sm); color: var(--text-secondary); margin: 2px 0 0; }

/* ---- 洗眼睛 ---- */
.eyewash {
  padding: var(--space-8);
  border: 1px solid color-mix(in srgb, var(--accent-cyan) 28%, var(--glass-border));
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--accent-cyan) 8%, var(--glass-bg)),
    var(--glass-bg)
  );
}
.eyewash__head { display: flex; align-items: center; gap: var(--space-4); }
.eyewash__badge {
  font: var(--font-micro);
  padding: 3px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-cyan) 16%, transparent);
  color: var(--accent-cyan);
  letter-spacing: 0.04em;
}
.eyewash__day { font: var(--font-micro); color: var(--text-muted); }
.eyewash__title { font: var(--font-h3); margin: var(--space-4) 0 var(--space-2); }
.eyewash__reason { font: var(--font-body-sm); color: var(--text-secondary); margin: 0 0 var(--space-5); }

.eyewash__ask {
  padding: var(--space-4) var(--space-5);
  border-left: 3px solid var(--accent-cyan);
  background: var(--glass-bg-faint);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  margin-bottom: var(--space-5);
}
.eyewash__ask-label { font: var(--font-micro); color: var(--accent-cyan); }
.eyewash__ask p { margin: var(--space-2) 0 0; font: var(--font-body); }

.eyewash__row { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; }

.eyewash__line { margin-top: var(--space-5); display: flex; flex-direction: column; gap: var(--space-2); }
.eyewash__line-label { font: var(--font-micro); color: var(--text-secondary); }
.eyewash__line-input { max-width: 460px; }
.eyewash__line-hint { font: var(--font-micro); color: var(--text-muted); }

/* ---- 推荐流 ---- */
.push-feed { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: var(--space-6); }
.push-card {
  display: flex; flex-direction: column; gap: var(--space-4);
  padding: var(--space-7); text-align: left;
}
.push-card__role {
  display: flex; align-items: center; gap: var(--space-3);
  font: var(--font-micro); color: var(--text-secondary); letter-spacing: 0.03em;
}
.push-card[data-kind="discover"] .push-card__role { color: var(--accent-blue); }
.push-card[data-kind="item"] .push-card__role { color: var(--line-media); }
.push-card[data-kind="topic"] .push-card__role { color: var(--accent-purple); }
.push-card__topic { margin-left: auto; color: var(--text-muted); }
.push-card__title { font: var(--font-h3); margin: 0; line-height: 1.4; }
.push-card__reason {
  font: var(--font-body-sm); color: var(--text-secondary); margin: 0;
  padding-left: var(--space-4); border-left: 2px solid var(--glass-border);
}
.push-card__reason b { display: block; color: var(--text-muted); font: var(--font-micro); margin-bottom: 2px; }
.push-card__hook { font: var(--font-body-sm); margin: 0; color: var(--text-primary); }
.push-card__actions { display: flex; align-items: center; gap: var(--space-3); margin-top: auto; padding-top: var(--space-3); }
.push-card__src { margin-left: auto; font: var(--font-micro); color: var(--text-muted); }
.push-card__src:hover { color: var(--accent-blue); }

.push-view__loading { display: flex; align-items: center; gap: var(--space-3); color: var(--text-secondary); }

.push-done { padding: var(--space-5) var(--space-6); font: var(--font-body-sm); }
.push-done summary { cursor: pointer; color: var(--text-secondary); }
.push-done ul { list-style: none; margin: var(--space-4) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
.push-done li { color: var(--text-muted); font: var(--font-body-sm); }
.push-done__kind { margin-right: var(--space-2); }
</style>
