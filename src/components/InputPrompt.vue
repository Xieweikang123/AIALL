<template>
  <Teleport to="body">
    <div v-if="inputState.show.value" class="input-overlay" @mousedown.self="inputState.onCancel()">
      <div class="input-popup" @mousedown.stop>
        <p class="input-title">{{ inputState.title.value }}</p>
        <input
          ref="inputRef"
          type="text"
          class="input-field"
          :value="inputState.defaultValue.value"
          :placeholder="inputState.placeholder.value"
          @keydown.enter="handleConfirm"
          @keydown.esc="inputState.onCancel()"
        />
        <div class="input-actions">
          <button type="button" class="input-btn input-cancel" @click="inputState.onCancel()">
            {{ inputState.cancelText.value }}
          </button>
          <button type="button" class="input-btn input-ok" @click="handleConfirm">
            {{ inputState.confirmText.value }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { ESCAPE_DISMISS_PRIORITY, registerEscapeDismiss } from "../composables/useEscapeDismiss";
import { useInputPrompt } from "../composables/useInputPrompt";

const inputState = useInputPrompt();
registerEscapeDismiss(inputState.show, () => inputState.onCancel(), ESCAPE_DISMISS_PRIORITY.MODAL);
const inputRef = ref<HTMLInputElement | null>(null);
const inputValue = ref("");

function handleConfirm() {
  inputValue.value = inputRef.value?.value ?? "";
  inputState.onConfirm(inputValue.value);
}

watch(
  () => inputState.show.value,
  async (visible) => {
    if (visible) {
      await nextTick();
      inputRef.value?.focus();
      inputRef.value?.select();
    }
  },
);
</script>

<style scoped>
.input-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
}

.input-popup {
  min-width: 320px;
  max-width: min(420px, calc(100vw - 32px));
  box-sizing: border-box;
  padding: 20px;
  border-radius: 10px;
  background: #1c2333;
  border: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.06);
  z-index: 10000;
}

.input-title {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.9);
}

.input-field {
  width: 100%;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(0, 0, 0, 0.3);
  color: rgba(255, 255, 255, 0.9);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
  transition: border-color 150ms ease;
}

.input-field:focus {
  border-color: #1f6feb;
}

.input-field::placeholder {
  color: rgba(255, 255, 255, 0.35);
}

.input-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.input-btn {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms ease;
}

.input-cancel {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.input-cancel:hover {
  background: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.9);
}

.input-ok {
  background: #1f6feb;
  color: #fff;
  border: 1px solid rgba(31, 111, 235, 0.5);
}

.input-ok:hover {
  background: #3580f5;
}
</style>
