<template>
  <div class="cursor-agent-folded" @click="$emit('expand')">
    <span class="cursor-agent-folded-icon">▶</span>
    <span class="cursor-agent-folded-text">{{ summary }}</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  summary: string;
}>();

defineEmits<{
  expand: [];
}>();
</script>

<style scoped>
.cursor-agent-folded {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  color: rgba(139, 148, 158, 0.85);
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: all 0.2s ease;
  user-select: none;
}

.cursor-agent-folded:hover {
  color: rgba(230, 237, 243, 0.92);
  background: rgba(88, 166, 255, 0.08);
  border-color: rgba(88, 166, 255, 0.2);
}

.cursor-agent-folded-icon {
  font-size: 8px;
  flex-shrink: 0;
  color: rgba(88, 166, 255, 0.6);
  transition: transform 0.2s ease;
}

.cursor-agent-folded:hover .cursor-agent-folded-icon {
  color: rgba(88, 166, 255, 0.9);
  transform: scale(1.15);
}

.cursor-agent-folded-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 320px;
}
</style>
