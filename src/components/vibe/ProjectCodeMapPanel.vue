<template>
  <div class="code-map-panel">
    <div v-if="!projectOpened" class="panel-empty">
      <p class="panel-empty-title">尚未打开项目</p>
      <p class="panel-empty-hint">打开项目后，在「项目 → 架构图」中生成模块脑图</p>
    </div>

    <template v-else>
      <div class="code-map-panel-card">
        <p class="code-map-panel-title">架构图</p>
        <p class="code-map-panel-desc">根据目录、入口与路由生成可交互模块脑图</p>
        <label class="code-map-panel-check">
          <input v-model="annotateProxy" type="checkbox" :disabled="building || annotating" />
          生成后 AI 标注
        </label>
        <button
          type="button"
          class="code-map-panel-btn"
          :disabled="building || annotating || loading"
          @click="emit('generate')"
        >
          {{ hasDocument ? "刷新架构图" : "生成架构图" }}
        </button>
        <button
          v-if="hasDocument"
          type="button"
          class="code-map-panel-btn code-map-panel-btn--ghost"
          :disabled="building || annotating || loading"
          title="恢复自动排布（清除拖拽位置）"
          @click="emit('reset-layout')"
        >
          重置布局
        </button>
        <button
          v-if="hasDocument && annotateReady"
          type="button"
          class="code-map-panel-btn code-map-panel-btn--ghost"
          :disabled="building || annotating"
          @click="emit('annotate')"
        >
          仅重新标注
        </button>
      </div>

      <p v-if="statusText" class="code-map-panel-hint" role="status">{{ statusText }}</p>

      <div v-if="hasDocument" class="code-map-panel-stats">
        <div>节点 {{ nodeCount }}</div>
        <div>边 {{ edgeCount }}</div>
        <div v-if="truncatedCount">已折叠 {{ truncatedCount }} 个次要模块</div>
        <div v-if="generatedAtLabel" class="code-map-panel-time">{{ generatedAtLabel }}</div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  projectOpened: boolean;
  hasDocument: boolean;
  loading: boolean;
  building: boolean;
  annotating: boolean;
  message: string;
  error: string;
  generatedAtLabel: string;
  nodeCount: number;
  edgeCount: number;
  truncatedCount: number;
  annotateEnabled: boolean;
  annotateReady: boolean;
}>();

const emit = defineEmits<{
  generate: [];
  annotate: [];
  "reset-layout": [];
  "update:annotateEnabled": [value: boolean];
}>();

const statusText = computed(() => props.error || props.message);

const annotateProxy = computed({
  get: () => props.annotateEnabled,
  set: (v: boolean) => emit("update:annotateEnabled", v),
});
</script>

<style scoped>
.code-map-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 8px 12px;
  min-height: 0;
}

.panel-empty {
  padding: 16px 8px;
  text-align: center;
  color: #a6adc8;
}

.panel-empty-title {
  margin: 0 0 6px;
  font-size: 13px;
  color: #cdd6f4;
}

.panel-empty-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
}

.code-map-panel-card {
  border: 1px solid rgba(205, 214, 244, 0.1);
  border-radius: 8px;
  background: #181825;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.code-map-panel-title {
  margin: 0;
  font-size: 13px;
  font-weight: 650;
  color: #cdd6f4;
}

.code-map-panel-desc {
  margin: 0;
  font-size: 12px;
  color: #a6adc8;
  line-height: 1.45;
}

.code-map-panel-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #a6adc8;
  cursor: pointer;
}

.code-map-panel-btn {
  border: 1px solid rgba(137, 180, 250, 0.4);
  background: rgba(137, 180, 250, 0.14);
  color: #cdd6f4;
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 12px;
  cursor: pointer;
}

.code-map-panel-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.code-map-panel-btn--ghost {
  background: transparent;
  border-color: rgba(205, 214, 244, 0.16);
}

.code-map-panel-hint {
  margin: 0;
  font-size: 12px;
  color: #a6adc8;
  line-height: 1.4;
}

.code-map-panel-stats {
  font-size: 12px;
  color: #6c7086;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 2px;
}

.code-map-panel-time {
  color: #a6adc8;
}
</style>
