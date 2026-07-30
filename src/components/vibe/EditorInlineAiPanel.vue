<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="editor-inline-ai-overlay"
      @mousedown.self="onDismiss"
    >
      <div
        class="editor-inline-ai-panel"
        :style="{ top: `${anchorTop}px`, left: `${anchorLeft}px` }"
        @mousedown.stop
      >
        <div class="editor-inline-ai-head">
          <span class="editor-inline-ai-title">Inline AI</span>
          <span class="editor-inline-ai-hint">Ctrl+K</span>
          <button type="button" class="ghost tiny" @click="onDismiss">关闭</button>
        </div>
        <textarea
          ref="inputRef"
          v-model="instructionModel"
          class="editor-inline-ai-input"
          rows="2"
          placeholder="描述要如何修改选区或当前文件…"
          :disabled="loading"
          @keydown.enter.exact.prevent="emit('submit')"
          @keydown.esc.prevent="onDismiss"
        />
        <p v-if="error" class="editor-inline-ai-error">{{ error }}</p>
        <pre v-if="preview" class="editor-inline-ai-preview">{{ preview }}</pre>
        <div class="editor-inline-ai-actions">
          <button
            type="button"
            class="secondary compact"
            :disabled="loading || !instructionModel.trim()"
            @click="emit('submit')"
          >
            {{ loading ? "生成中…" : preview ? "重新生成" : "生成" }}
          </button>
          <button
            type="button"
            class="primary compact"
            :disabled="loading || !preview.trim()"
            @click="emit('accept')"
          >
            接受
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

const props = defineProps<{
  open: boolean;
  instruction: string;
  loading: boolean;
  preview: string;
  error: string;
  anchorTop: number;
  anchorLeft: number;
}>();

const emit = defineEmits<{
  (e: "update:instruction", value: string): void;
  (e: "close"): void;
  (e: "submit"): void;
  (e: "accept"): void;
}>();

const inputRef = ref<HTMLTextAreaElement | null>(null);

const instructionModel = computed({
  get: () => props.instruction,
  set: (value: string) => emit("update:instruction", value),
});

function onDismiss() {
  if (props.loading) return;
  emit("close");
}

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    await nextTick();
    inputRef.value?.focus();
  },
);
</script>

<style scoped>
.editor-inline-ai-overlay {
  position: fixed;
  inset: 0;
  z-index: 12000;
}

.editor-inline-ai-panel {
  position: fixed;
  width: min(520px, calc(100vw - 32px));
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(18, 22, 34, 0.98);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
}

.editor-inline-ai-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.editor-inline-ai-title {
  font-size: 13px;
  font-weight: 600;
}

.editor-inline-ai-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
}

.editor-inline-ai-input {
  width: 100%;
  resize: vertical;
  min-height: 56px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  padding: 8px 10px;
  font: inherit;
}

.editor-inline-ai-preview {
  margin: 8px 0 0;
  max-height: 180px;
  overflow: auto;
  padding: 8px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
  font-size: 12px;
  white-space: pre-wrap;
}

.editor-inline-ai-error {
  margin: 8px 0 0;
  color: #ff9a9a;
  font-size: 12px;
}

.editor-inline-ai-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}
</style>
