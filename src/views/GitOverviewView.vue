<template>
  <div class="git-overview-page">
    <div class="page-head">
      <div class="page-title-wrap">
        <h1>Git 总览</h1>
        <p class="desc">多仓状态一览 · 分支、变更、操作入口集中查看</p>
      </div>
      <div class="head-actions">
        <div class="action-group nav-group">
          <router-link class="secondary link-btn" to="/vibe-coding">💻 Vibe Coding</router-link>
          <router-link class="secondary link-btn" to="/chat">💬 对话</router-link>
          <router-link class="secondary link-btn" to="/ai-config">⚙️ 配置</router-link>
        </div>
      </div>
    </div>

    <!-- 项目选择条 -->
    <div class="git-overview-project-bar">
      <div class="project-bar-main">
        <input
          v-model="projectPathInput"
          class="path-input"
          type="text"
          placeholder="项目根路径，例如 D:\project\my-app"
          @keydown.enter="applyProjectPath"
        />
        <button type="button" class="primary compact" :disabled="!projectPathInput.trim()" @click="applyProjectPath">
          打开
        </button>
        <button type="button" class="secondary" :disabled="loadingRepos" @click="loadRepos">
          {{ loadingRepos ? "加载中…" : "刷新" }}
        </button>
        <button
          v-if="projectPath"
          type="button"
          class="secondary"
          @click="openProjectFolder"
        >
          打开目录
        </button>
      </div>
      <div v-if="projectHistory.length" class="project-bar-history">
        <span class="history-label">最近：</span>
        <button
          v-for="h in projectHistory.slice(0, 5)"
          :key="h.path"
          type="button"
          class="ghost tiny history-chip"
          :class="{ active: h.path === projectPath }"
          :title="h.path"
          @click="pickHistory(h.path)"
        >
          {{ h.displayName }}
        </button>
      </div>
      <p v-if="reposError" class="git-error">{{ reposError }}</p>
      <p v-if="!projectPath" class="git-overview-empty-hint">请选择项目根路径，自动发现其下所有 Git 仓库。</p>
    </div>

    <!-- 统计条 -->
    <div v-if="projectPath" class="git-overview-stats">
      <span class="stats-item">全部仓库 <b>{{ gitRepos.length }}</b> 个</span>
      <span v-if="dirtyCount > 0" class="stats-item dirty">有变更 <b>{{ dirtyCount }}</b> 个</span>
      <span v-else-if="gitRepos.length" class="stats-item clean">全部干净</span>
      <span v-if="behindCount > 0" class="stats-item behind">↓ 待拉取 <b>{{ behindCount }}</b> 个</span>
      <span v-if="aheadCount > 0" class="stats-item ahead">↑ 待推送 <b>{{ aheadCount }}</b> 个</span>
      <span class="stats-spacer" />
      <span v-if="overviewLoading" class="stats-loading shimmer-text--fast">正在拉取变更…</span>
      <button type="button" class="ghost tiny" :disabled="loadingRepos || overviewLoading" @click="refreshAll">全部刷新</button>
    </div>

    <!-- 主列表：复用 GitMultiRepoOverview 组件，但在大屏下更宽 -->
    <div v-if="projectPath" class="git-overview-main">
      <div v-if="!gitRepos.length && !loadingRepos" class="panel-empty">
        <p class="panel-empty-title">未发现 Git 仓库</p>
        <p class="panel-empty-hint">当前目录不是 Git 仓库，也未在其子目录发现 .git</p>
      </div>
      <GitMultiRepoOverview
        v-else
        :entries="overview.entries.value"
        :loading="overview.overviewLoading.value"
        :error="overview.overviewError.value"
        :expanded-keys="overview.expandedRepos.value"
        @refresh="refreshAll"
        @refresh-single="refreshSingle"
        @switch-git-repo="handleSwitchRepo"
        @open-repo-folder="handleOpenFolder"
        @open-file="handleOpenFile"
        @stage-file="handleStageFile"
        @unstage-file="handleUnstageFile"
        @discard-file="handleDiscardFile"
        @stage-all="handleStageAll"
        @unstage-all="handleUnstageAll"
        @pull="handlePull"
        @push="handlePush"
        @fetch="handleFetch"
        @toggle-expanded="overview.toggleExpanded($event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import GitMultiRepoOverview from "../components/vibe/GitMultiRepoOverview.vue";
import { useGitMultiRepoOverview } from "../composables/git/useGitMultiRepoOverview";
import { fetchGitRepos, type GitRepoInfo } from "../services/vibeGitClient";
import { openProjectFolderInExplorer } from "../services/vibeCodingClient";
import { isTauriEnv } from "../services/tauriInvoke";
import { listProjectHistory } from "../services/vibeProjectHistory";
import { lsGet, lsSet } from "../utils/localStorageSafe";

const STORAGE_KEY = "vibe-coding-project";
const ACTIVE_REPO_KEY_PREFIX = "vibe-coding-git-active-repo:";

const router = useRouter();

const projectPath = ref((lsGet(STORAGE_KEY) || "").trim());
const projectPathInput = ref(projectPath.value);
const gitRepos = ref<GitRepoInfo[]>([]);
const loadingRepos = ref(false);
const reposError = ref("");
const projectHistory = ref(listProjectHistory());

const projectOpened = computed(() => Boolean(projectPath.value.trim()));

const overview = useGitMultiRepoOverview({
  gitRepos: () => gitRepos.value,
  projectOpened: () => projectOpened.value,
});

const overviewLoading = computed(() => overview.overviewLoading.value);

const dirtyCount = computed(() => overview.entries.value.filter((e) => e.files.length > 0).length);
const behindCount = computed(() => overview.entries.value.filter((e) => e.behind > 0).length);
const aheadCount = computed(() => overview.entries.value.filter((e) => e.ahead > 0).length);

function refreshHistory() {
  projectHistory.value = listProjectHistory();
}

async function loadRepos() {
  if (!projectPath.value.trim()) {
    gitRepos.value = [];
    return;
  }
  loadingRepos.value = true;
  reposError.value = "";
  try {
    const res = await fetchGitRepos(projectPath.value.trim());
    if (!res.ok) {
      reposError.value = res.error || "获取仓库列表失败";
      gitRepos.value = [];
      return;
    }
    gitRepos.value = res.repos;
    // 自动拉取总览
    if (res.repos.length) {
      void overview.refreshMultiRepoOverview();
    } else {
      overview.entries.value = [];
    }
  } catch (e) {
    reposError.value = e instanceof Error ? e.message : "网络错误";
    gitRepos.value = [];
  } finally {
    loadingRepos.value = false;
  }
}

function applyProjectPath() {
  const next = projectPathInput.value.trim();
  if (!next) return;
  projectPath.value = next;
  lsSet(STORAGE_KEY, next);
  refreshHistory();
  void loadRepos();
}

function pickHistory(path: string) {
  projectPathInput.value = path;
  applyProjectPath();
}

function refreshAll() {
  void loadRepos();
}

function refreshSingle(repoPath: string) {
  void overview.refreshSingleRepo(repoPath);
}

function handleSwitchRepo(repoPath: string) {
  if (!projectPath.value) return;
  lsSet(`${ACTIVE_REPO_KEY_PREFIX}${projectPath.value}`, repoPath);
  router.push("/vibe-coding");
}

async function handleOpenFolder(repoPath: string) {
  const res = await openProjectFolderInExplorer(repoPath);
  if (res.ok) {
    reposError.value = "";
    return;
  }
  if (!res.error) return;
  // 服务器无桌面环境时，降级为复制路径
  if (!isTauriEnv()) {
    try {
      await navigator.clipboard.writeText(repoPath);
      reposError.value = `${res.error}（已复制路径到剪贴板：${repoPath}）`;
      return;
    } catch {}
  }
  reposError.value = res.error;
}

function handleOpenFile(payload: { repoPath: string; filePath: string }) {
  const full = `${payload.repoPath.replace(/\/+$/, "")}/${payload.filePath.replace(/^\/+/, "")}`;
  lsSet(`${ACTIVE_REPO_KEY_PREFIX}${projectPath.value}`, payload.repoPath);
  // 将要打开的文件路径暂存在 sessionStorage，供 VibeCodingView 消费（或直接跳过去让用户手动打开）
  try {
    sessionStorage.setItem("git-overview-open-file", full);
  } catch {}
  router.push("/vibe-coding");
}

async function handleStageFile(payload: { repoPath: string; filePath: string }) {
  await overview.stageFile(payload.repoPath, payload.filePath);
}
async function handleUnstageFile(payload: { repoPath: string; filePath: string }) {
  await overview.unstageFile(payload.repoPath, payload.filePath);
}
async function handleDiscardFile(payload: { repoPath: string; filePath: string }) {
  if (!window.confirm(`丢弃 ${payload.filePath} 的未暂存改动？`)) return;
  await overview.discardFile(payload.repoPath, payload.filePath);
}
async function handleStageAll(repoPath: string) {
  await overview.stageAll(repoPath);
}
async function handleUnstageAll(repoPath: string) {
  await overview.unstageAll(repoPath);
}
async function handlePull(repoPath: string) {
  const r = await overview.pullRepo(repoPath);
  reposError.value = r.ok ? "" : r.error || "拉取失败";
  if (!r.ok && r.error) void loadRepos();
}
async function handlePush(repoPath: string) {
  const r = await overview.pushRepo(repoPath);
  reposError.value = r.ok ? "" : r.error || "推送失败";
}
async function handleFetch(repoPath: string) {
  const r = await overview.fetchRepo(repoPath);
  reposError.value = r.ok ? "" : r.error || "抓取失败";
}

async function openProjectFolder() {
  if (!projectPath.value) return;
  const res = await openProjectFolderInExplorer(projectPath.value);
  if (res.ok) {
    reposError.value = "";
    return;
  }
  if (!res.error) return;
  if (!isTauriEnv()) {
    try {
      await navigator.clipboard.writeText(projectPath.value);
      reposError.value = `${res.error}（已复制路径到剪贴板）`;
      return;
    } catch {}
  }
  reposError.value = res.error;
}

watch(projectPath, () => {
  projectPathInput.value = projectPath.value;
});

onMounted(() => {
  refreshHistory();
  if (projectPath.value) void loadRepos();
});
</script>

<style scoped>
.git-overview-page {
  min-height: 100vh;
  background: radial-gradient(900px 520px at 18% 8%, rgba(31, 111, 235, 0.12), transparent 62%),
    radial-gradient(900px 560px at 90% 0%, rgba(130, 80, 223, 0.14), transparent 60%),
    #0d1117;
  color: rgba(255, 255, 255, 0.92);
  padding: 20px 20px 32px;
}
.page-head {
  max-width: 1080px;
  margin: 0 auto 16px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.page-title-wrap h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.4px;
}
.page-title-wrap .desc {
  margin: 6px 0 0;
  font-size: 12px;
  color: rgba(201, 209, 217, 0.7);
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.link-btn {
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.git-overview-project-bar {
  max-width: 1080px;
  margin: 0 auto 12px;
  background: rgba(22,27,34,0.72);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(240,246,252,0.08);
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.18);
}
.project-bar-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.path-input {
  flex: 1;
  min-width: 240px;
  padding: 7px 10px;
  font-size: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.92);
  outline: none;
}
.path-input:focus {
  border-color: rgba(88, 166, 255, 0.5);
  box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.12);
}
.project-bar-history {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.history-label {
  font-size: 11px;
  color: rgba(139, 148, 158, 0.7);
}
.history-chip {
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  background: rgba(255, 255, 255, 0.04) !important;
}
.history-chip.active {
  background: rgba(88, 166, 255, 0.14) !important;
  border-color: rgba(88, 166, 255, 0.3) !important;
  color: #79c0ff !important;
}
.git-error {
  font-size: 12px;
  color: #ff9a9a;
  background: rgba(248, 81, 73, 0.08);
  border: 1px solid rgba(248, 81, 73, 0.2);
  border-radius: 6px;
  padding: 6px 8px;
  margin: 0;
}
.git-overview-empty-hint {
  font-size: 11px;
  color: rgba(139, 148, 158, 0.6);
  margin: 0;
}
.git-overview-stats {
  max-width: 1080px;
  margin: 0 auto 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #8b949e;
  flex-wrap: wrap;
}
.stats-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(240,246,252,0.06);
  border: 1px solid rgba(240,246,252,0.08);
  font-weight: 500;
}
.stats-item b {
  color: #f0f6fc;
  font-weight: 700;
}
.stats-item.dirty {
  color: #d29922;
  background: rgba(210,153,34,0.10);
  border-color: rgba(210,153,34,0.18);
}
.stats-item.clean {
  color: #8b949e;
}
.stats-item.behind {
  color: #ff7b72;
  background: rgba(248,81,73,0.10);
  border-color: rgba(248,81,73,0.18);
  font-weight: 600;
}
.stats-item.ahead {
  color: #3fb950;
  background: rgba(63,185,80,0.10);
  border-color: rgba(63,185,80,0.18);
  font-weight: 600;
}
.stats-spacer {
  flex: 1;
}
.stats-loading {
  color: rgba(139, 148, 158, 0.7);
}
.git-overview-main {
  max-width: 1080px;
  margin: 0 auto;
  background: rgba(22,27,34,0.45);
  border: 1px solid rgba(240,246,252,0.06);
  border-radius: 14px;
  padding: 14px 14px 12px;
  min-height: 320px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 24px rgba(0,0,0,0.22);
}
.panel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 48px 20px;
  color: rgba(139, 148, 158, 0.75);
}
.panel-empty-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  margin: 0;
}
.panel-empty-hint {
  font-size: 11px;
  margin: 0;
}
.secondary {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  cursor: pointer;
}
.secondary:hover {
  background: rgba(255, 255, 255, 0.1);
}
.primary {
  background: linear-gradient(135deg, #1f6feb 0%, #58a6ff 100%);
  color: #fff;
  border: none;
  padding: 7px 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.primary:disabled,
.secondary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.primary.compact {
  padding: 6px 12px;
}
.ghost {
  background: none;
  border: 1px solid transparent;
  color: rgba(201, 209, 217, 0.85);
  cursor: pointer;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 11px;
}
.ghost:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.92);
}
.ghost.tiny {
  padding: 4px 8px;
}
.shimmer-text--fast {
  animation: shimmer 1.2s ease-in-out infinite;
}
@keyframes shimmer {
  0%,
  100% {
    opacity: 0.6;
  }
  50% {
    opacity: 1;
  }
}
.action-group {
  display: flex;
  gap: 6px;
}
@media (max-width: 640px) {
  .git-overview-page {
    padding: 12px 10px 20px;
  }
  .page-head {
    flex-direction: column;
  }
}
</style>
