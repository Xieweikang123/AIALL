<template>
  <details v-if="previewLines.length" class="cursor-tool-row cursor-tool-row--details">
    <summary class="cursor-tool-row-summary">
      <div class="cursor-tool-row-content has-preview">
        <span class="cursor-tool-row-chevron">▸</span>
        <!-- Icon -->
        <div 
          class="cursor-tool-row-icon-wrap" 
          :class="[
            parsedStep.iconClass,
            { 
              'is-running': step.running, 
              'is-failed': failed,
              'shimmer-text--fast': step.running 
            }
          ]"
        >
          <component :is="parsedStep.iconComponent" class="step-icon-svg" />
        </div>

        <!-- Main Info -->
        <div class="cursor-tool-row-info">
          <span class="cursor-tool-row-action" :class="{ 'is-running': step.running, 'is-failed': failed }">
            {{ parsedStep.actionLabel }}
          </span>

          <!-- File Name & Path -->
          <template v-if="parsedStep.fileName">
            <span class="cursor-tool-row-filename-wrap">
              <button
                v-if="filePath"
                type="button"
                class="cursor-tool-row-filename cursor-tool-row-filename--link"
                :title="filePath"
                @click.stop="onLinkClick"
              >
                {{ parsedStep.fileName }}
              </button>
              <span v-else class="cursor-tool-row-filename">
                {{ parsedStep.fileName }}
              </span>
              <span v-if="parsedStep.dirPath" class="cursor-tool-row-dir" :title="filePath">
                {{ parsedStep.dirPath }}
              </span>
            </span>
          </template>

          <!-- Search Query -->
          <span v-else-if="parsedStep.isSearch && parsedStep.searchQuery" class="cursor-tool-row-query" :title="parsedStep.searchQuery">
            <code>{{ parsedStep.searchQuery }}</code>
          </span>

          <!-- Badge -->
          <span v-if="parsedStep.badgeText" class="cursor-tool-row-badge" :class="`is-${parsedStep.badgeType}`">
            {{ parsedStep.badgeText }}
          </span>
        </div>
      </div>
    </summary>
    <ul class="cursor-tool-row-preview">
      <li v-for="(line, index) in previewLines" :key="index">{{ line }}</li>
    </ul>
  </details>

  <div v-else class="cursor-tool-row">
    <div class="cursor-tool-row-content">
      <!-- Icon -->
      <div 
        class="cursor-tool-row-icon-wrap" 
        :class="[
          parsedStep.iconClass,
          { 
            'is-running': step.running, 
            'is-failed': failed,
            'shimmer-text--fast': step.running 
          }
        ]"
      >
        <component :is="parsedStep.iconComponent" class="step-icon-svg" />
      </div>

      <!-- Main Info -->
      <div class="cursor-tool-row-info">
        <span class="cursor-tool-row-action" :class="{ 'is-running': step.running, 'is-failed': failed }">
          {{ parsedStep.actionLabel }}
        </span>

        <!-- File Name & Path -->
        <template v-if="parsedStep.fileName">
          <span class="cursor-tool-row-filename-wrap">
            <button
              v-if="filePath"
              type="button"
              class="cursor-tool-row-filename cursor-tool-row-filename--link"
              :title="filePath"
              @click="onLinkClick"
            >
              {{ parsedStep.fileName }}
            </button>
            <span v-else class="cursor-tool-row-filename">
              {{ parsedStep.fileName }}
            </span>
            <span v-if="parsedStep.dirPath" class="cursor-tool-row-dir" :title="filePath">
              {{ parsedStep.dirPath }}
            </span>
          </span>
        </template>

        <!-- Search Query -->
        <span v-else-if="parsedStep.isSearch && parsedStep.searchQuery" class="cursor-tool-row-query" :title="parsedStep.searchQuery">
          <code>{{ parsedStep.searchQuery }}</code>
        </span>

        <!-- Badge -->
        <span v-if="parsedStep.badgeText" class="cursor-tool-row-badge" :class="`is-${parsedStep.badgeType}`">
          {{ parsedStep.badgeText }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, h } from "vue";
import { isReadFilePolicyBlock } from "../services/agentCursorFeed";
import type { AgentRoundTool } from "../services/agentRoundGroups";
import { getToolPath } from "../utils/toolHelpers";
import { backendUrl } from "../services/backendBase";

// Inline SVG Icon components for premium feel
const FileIcon = () => h("svg", { class: "step-icon-svg icon-file", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2" }, [
  h("path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }),
  h("polyline", { points: "14 2 14 8 20 8" })
]);

const EditIcon = () => h("svg", { class: "step-icon-svg icon-edit", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2" }, [
  h("path", { d: "M12 20h9" }),
  h("path", { d: "M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" })
]);

const TrashIcon = () => h("svg", { class: "step-icon-svg icon-trash", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2" }, [
  h("polyline", { points: "3 6 5 6 21 6" }),
  h("path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" })
]);

const SearchIcon = () => h("svg", { class: "step-icon-svg icon-search", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2" }, [
  h("circle", { cx: "11", cy: "11", r: "8" }),
  h("line", { x1: "21", y1: "21", x2: "16.65", y2: "16.65" })
]);

const FolderIcon = () => h("svg", { class: "step-icon-svg icon-folder", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2" }, [
  h("path", { d: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" })
]);

const GlobeIcon = () => h("svg", { class: "step-icon-svg icon-globe", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2" }, [
  h("circle", { cx: "12", cy: "12", r: "10" }),
  h("line", { x1: "2", y1: "12", x2: "22", y2: "12" }),
  h("path", { d: "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" })
]);

const TerminalIcon = () => h("svg", { class: "step-icon-svg icon-terminal", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2" }, [
  h("rect", { x: "2", y: "3", width: "20", height: "14", rx: "2", ry: "2" }),
  h("line", { x1: "8", y1: "21", x2: "16", y2: "21" }),
  h("line", { x1: "12", y1: "17", x2: "12", y2: "21" })
]);

const props = defineProps<{
  step: AgentRoundTool;
}>();

const emit = defineEmits<{
  openFile: [path: string];
}>();

const failed = computed(() => !props.step.ok && !props.step.running);
const filePath = computed(() => {
  const path = getToolPath(props.step);
  return path || "";
});

function onLinkClick() {
  const target = filePath.value;
  if (/^https?:\/\//i.test(target)) {
    fetch(backendUrl(`/backend/open-url?url=${encodeURIComponent(target)}`)).catch((err) => {
      console.error("Failed to open URL via backend:", err);
      window.open(target, "_blank", "noopener,noreferrer");
    });
  } else {
    emit("openFile", target);
  }
}

const previewLines = computed((): string[] => {
  const raw = props.step.fullResult?.trim();
  if (!raw || raw === "（无匹配）" || raw === "（无匹配文件）") return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((line) => (line.length > 96 ? `${line.slice(0, 96)}…` : line));
});

const parsedStep = computed(() => {
  const name = props.step.name;
  const path = String(props.step.args?.path ?? props.step.detail?.split(" · ")[0] ?? "").trim();
  const pattern = String(props.step.args?.pattern ?? "").trim();
  const query = String(props.step.args?.query ?? "").trim();
  const content = typeof props.step.args?.content === "string" ? props.step.args.content : "";
  const running = Boolean(props.step.running);

  let fileName = "";
  let dirPath = "";
  if (path) {
    const normPath = path.replace(/\\/g, "/");
    const lastSlash = normPath.lastIndexOf("/");
    if (lastSlash !== -1) {
      fileName = normPath.slice(lastSlash + 1);
      dirPath = normPath.slice(0, lastSlash + 1);
    } else {
      fileName = normPath;
    }
  }

  let iconComponent = TerminalIcon;
  let iconClass = "is-misc";
  let actionLabel = "";
  let badgeText = "";
  let badgeType = "";
  let isSearch = false;
  let searchQuery = "";

  if (name === "read_file") {
    iconComponent = FileIcon;
    iconClass = "is-file";
    actionLabel = running ? "Read" : failed.value ? "Read failed" : "Read";
    if (isReadFilePolicyBlock(props.step.summary)) {
      actionLabel = "Skipped";
    }
    const lines = props.step.summary?.match(/(\d+)/)?.[1];
    if (lines) {
      badgeText = `${lines} lines`;
      badgeType = "info";
    }
  } else if (name === "write_file" || name === "patch_file") {
    iconComponent = EditIcon;
    iconClass = "is-edit";
    actionLabel = running ? "Edit" : failed.value ? "Edit failed" : "Edited";
    const delta = props.step.lineDelta ?? (content ? Math.min(content.split(/\r?\n/).length, 999) : 0);
    if (delta) {
      badgeText = `+${delta}`;
      badgeType = "success";
    }
  } else if (name === "delete_file") {
    iconComponent = TrashIcon;
    iconClass = "is-delete";
    actionLabel = running ? "Delete" : failed.value ? "Delete failed" : "Deleted";
  } else if (name === "grep" || name === "search_files") {
    iconComponent = SearchIcon;
    iconClass = "is-search";
    actionLabel = running ? "Search" : failed.value ? "Search failed" : "Searched";
    isSearch = true;
    searchQuery = name === "grep" ? pattern : query;
  } else if (name === "list_dir") {
    iconComponent = FolderIcon;
    iconClass = "is-folder";
    actionLabel = running ? "Explore" : failed.value ? "Explore failed" : "Explored";
  } else if (name === "web_search") {
    iconComponent = GlobeIcon;
    iconClass = "is-web";
    actionLabel = running ? "Web search" : failed.value ? "Web search failed" : "Searched web";
    isSearch = true;
    searchQuery = query;
  } else if (name === "web_extract") {
    iconComponent = GlobeIcon;
    iconClass = "is-web";
    actionLabel = running ? "Fetch" : failed.value ? "Fetch failed" : "Fetched";
    const url = String(props.step.args?.url ?? props.step.detail ?? "").trim();
    fileName = url.length > 32 ? `${url.slice(0, 32)}…` : url;
  } else {
    iconComponent = TerminalIcon;
    iconClass = "is-misc";
    actionLabel = props.step.title || props.step.label || name;
  }

  return {
    iconComponent,
    iconClass,
    actionLabel,
    fileName,
    dirPath,
    badgeText,
    badgeType,
    isSearch,
    searchQuery,
  };
});
</script>

<style scoped>
.cursor-tool-row {
  position: relative;
  min-width: 0;
  padding: 3px 0;
}

/* Timeline connector line */
.cursor-tool-row::before {
  content: "";
  position: absolute;
  left: 15px; /* Aligns with the center of the 18px icon (6px left padding + 9px half-width) */
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(148, 163, 184, 0.08);
  z-index: 0;
}

/* Hide timeline line for details body list items */
.cursor-tool-row-preview li::before {
  display: none;
}

.cursor-tool-row-summary {
  list-style: none;
  cursor: pointer;
  user-select: none;
  padding: 0;
}

.cursor-tool-row-summary::-webkit-details-marker {
  display: none;
}

.cursor-tool-row-content {
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
  z-index: 1;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background-color 0.15s ease;
}

.cursor-tool-row-content:hover {
  background-color: rgba(255, 255, 255, 0.03);
}

.cursor-tool-row-chevron {
  font-size: 8px;
  color: rgba(148, 163, 184, 0.35);
  width: 8px;
  margin-left: -4px;
  transition: transform 0.15s ease;
  user-select: none;
}

.cursor-tool-row--details[open] .cursor-tool-row-chevron {
  transform: rotate(90deg);
}

/* Icon Wrapper */
.cursor-tool-row-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: rgba(148, 163, 184, 0.06);
  color: rgba(148, 163, 184, 0.6);
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.step-icon-svg {
  width: 11px;
  height: 11px;
  display: block;
}

/* Icon Colors */
.cursor-tool-row-icon-wrap.is-file {
  background: rgba(56, 189, 248, 0.08);
  color: rgba(56, 189, 248, 0.8);
}
.cursor-tool-row-icon-wrap.is-edit {
  background: rgba(34, 197, 94, 0.08);
  color: rgba(34, 197, 94, 0.8);
}
.cursor-tool-row-icon-wrap.is-delete {
  background: rgba(239, 68, 68, 0.08);
  color: rgba(239, 68, 68, 0.8);
}
.cursor-tool-row-icon-wrap.is-search {
  background: rgba(168, 85, 247, 0.08);
  color: rgba(168, 85, 247, 0.8);
}
.cursor-tool-row-icon-wrap.is-folder {
  background: rgba(234, 179, 8, 0.08);
  color: rgba(234, 179, 8, 0.8);
}
.cursor-tool-row-icon-wrap.is-web {
  background: rgba(20, 184, 166, 0.08);
  color: rgba(20, 184, 166, 0.8);
}

.cursor-tool-row-icon-wrap.is-running {
  background: rgba(56, 189, 248, 0.12);
  color: rgba(56, 189, 248, 0.95);
  animation: pulse 1.5s infinite ease-in-out;
}

.cursor-tool-row-icon-wrap.is-failed {
  background: rgba(239, 68, 68, 0.12);
  color: rgba(239, 68, 68, 0.95);
}

/* Info Layout */
.cursor-tool-row-info {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.cursor-tool-row-action {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: rgba(148, 163, 184, 0.65);
  white-space: nowrap;
}

.cursor-tool-row-action.is-running {
  color: rgba(56, 189, 248, 0.85);
}

.cursor-tool-row-action.is-failed {
  color: rgba(239, 68, 68, 0.85);
}

/* Filename & Dir */
.cursor-tool-row-filename-wrap {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
}

.cursor-tool-row-filename {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  font-weight: 600;
  color: rgba(248, 250, 252, 0.85);
  border: none;
  background: transparent;
  padding: 0;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  text-align: left;
}

.cursor-tool-row-filename--link {
  cursor: pointer;
}

.cursor-tool-row-filename--link:hover {
  color: #38bdf8;
  text-decoration: underline;
}

.cursor-tool-row-dir {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  color: rgba(148, 163, 184, 0.4);
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  max-width: 160px;
}

/* Search Query */
.cursor-tool-row-query {
  display: inline-flex;
  min-width: 0;
  max-width: 260px;
}

.cursor-tool-row-query code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(248, 250, 252, 0.7);
  padding: 1px 4px;
  border-radius: 3px;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}

/* Badges */
.cursor-tool-row-badge {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
  white-space: nowrap;
}

.cursor-tool-row-badge.is-info {
  background: rgba(148, 163, 184, 0.08);
  color: rgba(148, 163, 184, 0.7);
}

.cursor-tool-row-badge.is-success {
  background: rgba(34, 197, 94, 0.08);
  color: rgba(34, 197, 94, 0.8);
  font-weight: 600;
}

/* Previews list */
.cursor-tool-row-preview {
  margin: 2px 0 4px 26px; /* Aligns under the text info area */
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.cursor-tool-row-preview li {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  line-height: 1.35;
  color: rgba(148, 163, 184, 0.5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.7;
    transform: scale(0.95);
  }
}
</style>
