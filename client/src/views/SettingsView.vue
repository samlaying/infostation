<script setup>
import { ref, computed, onMounted } from 'vue';
import { useAppStore } from '../stores/app';
import { exportJson, importJson, clearAllData } from '../api';
import { CATEGORY_MAP } from '../constants';
import { toast, toastError, toastSuccess } from '../stores/toast';

const appStore = useAppStore();

const goals = ref([]);
const savingGoals = ref(false);
const importing = ref(false);
const fileInput = ref(null);

onMounted(async () => {
  if (!appStore.loaded) await appStore.load();
  goals.value = [...(appStore.settings?.user_goals || ['career', 'media', 'sidehustle'])];
});

const llm = computed(() => appStore.settings?.llm || {});
const counts = computed(() => appStore.settings?.counts || {});

async function saveGoals() {
  if (!goals.value.length) {
    toastError('至少选择一个目标领域');
    return;
  }
  savingGoals.value = true;
  try {
    await appStore.saveGoals(goals.value);
    toastSuccess('目标偏好已保存，私秘 Agent 会优先围绕这些领域工作');
  } catch (e) {
    toastError(e.message);
  } finally {
    savingGoals.value = false;
  }
}

function toggleGoal(key) {
  const i = goals.value.indexOf(key);
  if (i !== -1) goals.value.splice(i, 1);
  else goals.value.push(key);
}

function downloadJson() {
  exportJson().then((data) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `infostation-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toastSuccess('已导出 JSON 备份');
  }).catch((e) => toastError(e.message));
}

function downloadMarkdown() {
  window.open('/api/v1/export/markdown', '_blank');
  toast('Markdown 归档已在新标签页打开', 'info');
}

async function onImportFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  importing.value = true;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const res = await importJson(payload);
    toastSuccess(`导入完成：${res.items_imported} 条信息，${res.todos_imported} 条 TODO`);
    await appStore.load();
  } catch (err) {
    toastError(err.message || '导入失败：文件格式不正确');
  } finally {
    importing.value = false;
    e.target.value = '';
  }
}

async function clearData() {
  if (!confirm('确定清空全部数据（信息 / TODO / 周报）？此操作不可恢复。')) return;
  if (!confirm('再次确认：真的要清空所有数据吗？建议先导出备份。')) return;
  try {
    await clearAllData();
    toastSuccess('数据已清空');
    await appStore.load();
  } catch (e) {
    toastError(e.message);
  }
}
</script>

<template>
  <div v-if="appStore.settings" class="settings">
    <!-- Agent 配置 -->
    <section class="glass-panel settings__panel">
      <h2>🤖 Agent 配置</h2>
      <div class="settings__agent-status">
        <span class="settings__agent-dot" :class="{ 'is-llm': appStore.llmConfigured }" />
        <div class="settings__agent-info">
          <div class="settings__agent-mode">
            {{ appStore.llmConfigured ? '私秘 Agent（LLM 模式）' : '规则引擎（Mock 模式）' }}
          </div>
          <div class="timestamp">
            {{ llm.key_hint }} · {{ llm.base_url }} · 模型 {{ llm.model }}
          </div>
        </div>
      </div>
      <div v-if="!appStore.llmConfigured" class="settings__hint">
        当前未配置 LLM API Key，信息处理由内置规则引擎完成（关键词分类 + 行动动词 TODO 提取）。
        在 <code>server/.env</code> 中配置 <code>LLM_API_KEY</code>（支持 DeepSeek / Kimi / GLM / OpenAI 等兼容接口）后重启服务，
        即可启用「私秘」Agent 的完整能力：精准摘要、语义分类、智能 TODO 提取与关联建议。
      </div>
    </section>

    <!-- 目标偏好 -->
    <section class="glass-panel settings__panel">
      <h2>🎯 目标领域偏好</h2>
      <p class="settings__desc">Agent 处理信息时会优先围绕你选择的目标领域做分类与 TODO 匹配（建议保持 3 个以内）。</p>
      <div class="settings__goals">
        <button
          v-for="(c, key) in CATEGORY_MAP"
          :key="key"
          class="filter-chip"
          :class="{ 'is-active': goals.includes(key) }"
          @click="toggleGoal(key)"
        >
          {{ c.icon }} {{ c.label }}
        </button>
      </div>
      <div class="settings__actions">
        <button class="btn btn--primary" :disabled="savingGoals" @click="saveGoals">
          {{ savingGoals ? '保存中…' : '保存偏好' }}
        </button>
      </div>
    </section>

    <!-- 数据管理 -->
    <section class="glass-panel settings__panel">
      <h2>💾 数据管理</h2>
      <p class="settings__desc">
        当前共 {{ counts.items }} 条信息 · {{ counts.todos }} 条 TODO · {{ counts.reports }} 份周报。
        数据保存在服务端 SQLite（server/data/），完全本地，不上传云端。
      </p>
      <div class="settings__actions settings__actions--wrap">
        <button class="btn btn--glass" @click="downloadJson">⬇ 导出 JSON 备份</button>
        <button class="btn btn--glass" @click="downloadMarkdown">⬇ 导出 Markdown 归档</button>
        <button class="btn btn--glass" :disabled="importing" @click="fileInput?.click()">
          {{ importing ? '导入中…' : '⬆ 导入 JSON 备份' }}
        </button>
        <input ref="fileInput" type="file" accept="application/json" hidden @change="onImportFile" />
      </div>
    </section>

    <!-- 危险区 -->
    <section class="glass-panel settings__panel settings__panel--danger">
      <h2>⚠️ 危险区</h2>
      <div class="settings__actions">
        <button class="btn btn--danger" @click="clearData">🗑 清空全部数据</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings {
  max-width: 760px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-9);
}

.settings__panel { padding: var(--space-11); }
.settings__panel--danger { border-color: rgba(239, 68, 68, 0.3); }

.settings__panel h2 { margin-bottom: var(--space-7); }

.settings__agent-status {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  margin-bottom: var(--space-6);
}
.settings__agent-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent-orange);
  box-shadow: 0 0 12px var(--accent-orange);
}
.settings__agent-dot.is-llm {
  background: var(--accent-green);
  box-shadow: 0 0 12px var(--accent-green);
}
.settings__agent-mode { font: var(--font-h3); margin-bottom: var(--space-2); }

.settings__hint {
  font: var(--font-secondary);
  color: var(--text-secondary);
  line-height: 1.8;
  padding: var(--space-6);
  background: rgba(245, 158, 11, 0.06);
  border: 1px solid rgba(245, 158, 11, 0.25);
  border-radius: var(--radius-sm);
}
.settings__hint code {
  padding: 1px 6px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  font-size: 12px;
  color: var(--accent-cyan);
}

.settings__desc {
  font: var(--font-secondary);
  color: var(--text-secondary);
  line-height: 1.7;
  margin-bottom: var(--space-6);
}

.settings__goals { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-bottom: var(--space-7); }

.settings__actions { display: flex; gap: var(--space-4); }
.settings__actions--wrap { flex-wrap: wrap; }
</style>
