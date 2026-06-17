<template>
  <Teleport to="body">
    <div v-if="confirmState.show.value" class="confirm-overlay" @mousedown.self="confirmState.onCancel()">
      <div
        ref="popupRef"
        class="confirm-popup"
        :style="{ left: popupPosition.x + 'px', top: popupPosition.y + 'px' }"
        @mousedown.stop
      >
        <p class="confirm-message">{{ confirmState.message.value }}</p>
        <div class="confirm-actions">
          <button type="button" class="confirm-btn confirm-cancel" @click="confirmState.onCancel()">
            {{ confirmState.cancelText.value }}
          </button>
          <button type="button" class="confirm-btn confirm-ok" @click="confirmState.onConfirm()">
            {{ confirmState.confirmText.value }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useConfirm } from "../composables/useConfirm";
import { ESCAPE_DISMISS_PRIORITY, registerEscapeDismiss } from "../composables/useEscapeDismiss";

const confirmState = useConfirm();
registerEscapeDismiss(confirmState.show, () => confirmState.onCancel(), ESCAPE_DISMISS_PRIORITY.MODAL);
const popupRef = ref<HTMLElement | null>(null);
const popupPosition = ref({ x: 0, y: 0 });

async function syncPopupPosition() {
  if (!confirmState.show.value) return;
  popupPosition.value = confirmState.position.value;
  await nextTick();

  const el = popupRef.value;
  if (!el) return;

  const margin = 16;
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const maxX = Math.max(margin, window.innerWidth - width - margin);
  const maxY = Math.max(margin, window.innerHeight - height - margin);

  popupPosition.value = {
    x: Math.min(Math.max(confirmState.position.value.x, margin), maxX),
    y: Math.min(Math.max(confirmState.position.value.y, margin), maxY),
  };
}

watch(
  () => [confirmState.show.value, confirmState.position.value.x, confirmState.position.value.y, confirmState.message.value],
  () => {
    void syncPopupPosition();
  },
);
</script>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
}

.confirm-popup {
  position: fixed;
  min-width: 240px;
  max-width: min(360px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  overflow: auto;
  box-sizing: border-box;
  padding: 16px 20px;
  border-radius: 10px;
  background: #1c2333;
  border: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.06);
  z-index: 10000;
}

.confirm-message {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.9);
  white-space: pre-wrap;
  word-break: break-word;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.confirm-btn {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms ease;
}

.confirm-cancel {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.confirm-cancel:hover {
  background: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.9);
}

.confirm-ok {
  background: #1f6feb;
  color: #fff;
  border: 1px solid rgba(31, 111, 235, 0.5);
}

.confirm-ok:hover {
  background: #3580f5;
}
</style>
