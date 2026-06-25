<template>
  <div v-if="showReportChrome" class="project-report">
    <div class="project-report-head">
      <div class="project-report-title">
        <span class="project-report-badge">项目报告</span>
        <span v-if="streaming" class="project-report-badge project-report-badge--draft">生成中</span>
        <span v-if="turnHint" class="project-report-meta">{{ turnHint }}</span>
      </div>
      <div v-if="!streaming && canContinue" class="project-report-actions">
        <button type="button" class="project-report-btn" title="补充探索遗漏模块" @click="emit('continue-explore')">
          继续探索
        </button>
        <button
          v-if="showArchiveLink"
          type="button"
          class="project-report-btn project-report-btn--ghost"
          @click="emit('open-archive')"
        >
          探索归档
        </button>
      </div>
    </div>

    <nav v-if="display.sections.length > 1 && !streaming" class="project-report-toc" aria-label="报告目录">
      <button
        v-for="(section, index) in display.sections"
        :key="section.id"
        type="button"
        class="project-report-toc-item"
        @click="scrollToSection(index)"
      >
        {{ section.title }}
      </button>
    </nav>

    <div ref="bodyRef" class="project-report-body" @click="onBodyClick">
      <slot />
    </div>

    <div v-if="!streaming && showChips" class="project-report-chips">
      <span class="project-report-chips-label">快捷追问</span>
      <button
        v-for="chip in chips"
        :key="chip"
        type="button"
        class="project-report-chip"
        @click="emit('follow-up', chip)"
      >
        {{ chip }}
      </button>
    </div>
  </div>
  <slot v-else />
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { EXPLORE_QUICK_FOLLOWUP_CHIPS } from "../services/agentExplore";
import { parseProjectReportDisplay } from "../services/projectReportDisplay";

const props = withDefaults(
  defineProps<{
    content: string;
    chatMode?: "ask" | "build" | "plan" | "explore";
    streaming?: boolean;
    canContinue?: boolean;
    showArchiveLink?: boolean;
    showChips?: boolean;
    turnHint?: string;
  }>(),
  {
    streaming: false,
    canContinue: false,
    showArchiveLink: true,
    showChips: true,
    turnHint: "",
  },
);

const emit = defineEmits<{
  "continue-explore": [];
  "open-archive": [];
  "follow-up": [text: string];
  "open-file": [path: string];
}>();

const bodyRef = ref<HTMLElement | null>(null);
const display = computed(() => parseProjectReportDisplay(props.content));
const showReportChrome = computed(
  () => props.chatMode === "explore" && display.value.isProjectReport,
);
const chips = EXPLORE_QUICK_FOLLOWUP_CHIPS;

function scrollToSection(index: number) {
  const root = bodyRef.value;
  if (!root) return;
  const headings = root.querySelectorAll("h2, h3");
  const target = headings[index];
  if (target instanceof HTMLElement) {
    target.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

const FILE_PATH_IN_CODE_RE =
  /^(?:[\w@.-]+\/)*[\w.-]+\.(?:vue|ts|tsx|js|jsx|scss|css|json|md|html|py|rs|go|toml)$/i;

function onBodyClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const code = target.closest("code");
  if (!code) return;
  const text = code.textContent?.trim() ?? "";
  if (!text || !FILE_PATH_IN_CODE_RE.test(text)) return;
  if (text.includes("://") || text.startsWith(".")) return;
  emit("open-file", text.replace(/\\/g, "/"));
}
</script>

<style scoped>
.project-report {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 4px 0 0;
}

.project-report-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 4px 0 6px;
  border: none;
  border-bottom: 1px solid rgba(63, 185, 80, 0.14);
  border-radius: 0;
  background: transparent;
}

.project-report-title {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}

.project-report-badge {
  display: inline-flex;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(63, 185, 80, 0.16);
  color: rgba(183, 235, 198, 0.98);
  font-size: 11px;
  font-weight: 600;
}

.project-report-badge--draft {
  background: rgba(210, 153, 34, 0.14);
  color: rgba(255, 214, 130, 0.96);
}

.project-report-meta {
  color: rgba(139, 148, 158, 0.92);
  font-size: 12px;
}

.project-report-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.project-report-btn {
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid rgba(63, 185, 80, 0.45);
  background: rgba(63, 185, 80, 0.12);
  color: rgba(200, 245, 210, 0.98);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.project-report-btn--ghost {
  border-color: rgba(255, 255, 255, 0.12);
  background: transparent;
  color: rgba(180, 190, 200, 0.95);
  font-weight: 500;
}

.project-report-toc {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 4px;
}

.project-report-toc-item {
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(180, 190, 200, 0.95);
  font-size: 11px;
  cursor: pointer;
}

.project-report-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 4px 0 0;
}

.project-report-chips-label {
  font-size: 11px;
  color: rgba(139, 148, 158, 0.9);
}

.project-report-chip {
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px dashed rgba(255, 255, 255, 0.14);
  background: transparent;
  color: rgba(190, 200, 210, 0.95);
  font-size: 11px;
  cursor: pointer;
}

.project-report-body :deep(code) {
  cursor: pointer;
}
</style>
