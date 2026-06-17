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
        打开本地项目，让 AI Agent 探索代码、修改文件、执行任务。支持 Ask / Plan / Build 三种模式。
      </p>
      <button type="button" class="primary" :disabled="pickingFolder || loadingTree" @click="$emit('open-project')">
        {{ pickingFolder ? "选择文件夹…" : "打开项目" }}
      </button>
      <p class="vibe-welcome-hint">或在顶部输入项目路径后按 Enter</p>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  show: boolean;
  loadingTree?: boolean;
  pickingFolder?: boolean;
}>();

defineEmits<{
  (e: "open-project"): void;
}>();
</script>
