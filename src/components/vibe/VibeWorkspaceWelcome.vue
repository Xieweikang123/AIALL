<template>
  <div v-if="show" class="vibe-welcome" role="region" aria-label="欢迎">
    <div class="vibe-welcome-card">
      <div class="vibe-welcome-logo" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2L3 7v10l9 5 9-5V7l-9-5Z"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linejoin="round"
          />
          <path d="M12 12 3 7M12 12l9-5M12 12v10" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
        </svg>
      </div>
      <h2 class="vibe-welcome-title">开始 Vibe Coding</h2>
      <p class="vibe-welcome-desc">
        打开本地项目，让 Agent 探索代码、修改文件。支持 Ask / Plan / Build。
      </p>

      <ol class="vibe-welcome-steps" aria-label="上手步骤">
        <li class="vibe-welcome-step is-active">
          <span class="vibe-welcome-step-num">1</span>
          <div class="vibe-welcome-step-body">
            <strong>打开项目</strong>
            <span>选择本地代码文件夹</span>
          </div>
        </li>
        <li class="vibe-welcome-step" :class="{ 'is-done': configReady && apiKeyReady }">
          <span class="vibe-welcome-step-num">2</span>
          <div class="vibe-welcome-step-body">
            <strong>配置模型</strong>
            <span>{{ configStepHint }}</span>
          </div>
        </li>
        <li class="vibe-welcome-step">
          <span class="vibe-welcome-step-num">3</span>
          <div class="vibe-welcome-step-body">
            <strong>在助手中提问</strong>
            <span>Ask 答疑 · Plan 方案 · Build 改码</span>
          </div>
        </li>
      </ol>

      <div class="vibe-welcome-actions">
        <button type="button" class="primary" :disabled="pickingFolder || loadingTree" @click="$emit('open-project')">
          {{ pickingFolder ? "选择文件夹…" : "打开项目" }}
        </button>
        <button
          v-if="!configReady || !apiKeyReady"
          type="button"
          class="secondary"
          @click="$emit('open-ai-config')"
        >
          去配置模型
        </button>
      </div>
      <p class="vibe-welcome-hint">或在顶部输入项目路径后按 Enter</p>
      <p class="vibe-welcome-footnote">
        改码用本页；网页总结 / 桌面自动化请用顶部「对话」与「图标模板」。
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  show: boolean;
  loadingTree?: boolean;
  pickingFolder?: boolean;
  configReady?: boolean;
  apiKeyReady?: boolean;
}>();

defineEmits<{
  (e: "open-project"): void;
  (e: "open-ai-config"): void;
}>();

const configStepHint = computed(() => {
  if (!props.configReady) return "填写接口与模型";
  if (!props.apiKeyReady) return "请保存 API Key";
  return "已就绪";
});
</script>
