<template>
  <div class="panel-empty">
    <span v-if="icon" class="panel-empty-icon" aria-hidden="true">{{ icon }}</span>
    <p class="panel-empty-title">{{ title }}</p>
    <p v-if="hint" class="panel-empty-hint">{{ hint }}</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  icon?: string;
  title: string;
  hint?: string;
}>();
</script>

<style scoped>
.panel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: rgba(139, 148, 158, 0.6);
  font-size: 12px;
  gap: 8px;
  padding: 24px;
  text-align: center;
  box-sizing: border-box;
}
.panel-empty-icon {
  font-size: 28px;
  line-height: 1;
}
.panel-empty-title {
  font-weight: 600;
  margin: 0;
  color: inherit;
}
.panel-empty-hint {
  font-size: 12px;
  margin: 0;
  line-height: 1.4;
}
</style>
