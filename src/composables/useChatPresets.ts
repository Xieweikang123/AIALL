import { computed, ref, type Ref } from "vue";
import {
  DEFAULT_PROMPT_PRESETS,
  createPromptPresetId,
  readPromptPresets,
  writePromptPresets,
  type PromptPreset,
} from "../utils/promptPresetsStorage";
import { ESCAPE_DISMISS_PRIORITY, registerEscapeDismiss } from "./useEscapeDismiss";

/** 下拉最多展示的候选数 */
const PRESET_RESULT_LIMIT = 12;

export type UseChatPresetsOptions = {
  /** 把选中的预设正文填进输入框（不发送） */
  insertPreset: (content: string) => void;
  /** 选中后重新聚焦输入框 */
  focusComposer: () => void;
};

/**
 * 会话输入框「/ 预设提示词」：与 useChatMention 平行的另一条触发链路。
 * 负责触发词解析结果、下拉候选、以及预设的增删改（全局 localStorage）。
 */
export function useChatPresets(options: UseChatPresetsOptions) {
  const presets = ref<PromptPreset[]>(readPromptPresets());
  const presetOpen = ref(false);
  const presetQuery = ref("");
  const presetActiveIndex = ref(0);
  const presetManagerOpen = ref(false);

  function reloadPresets() {
    presets.value = readPromptPresets();
  }

  const presetResults = computed(() => {
    if (!presetOpen.value) return [];
    const q = presetQuery.value.trim().toLowerCase();
    const list = q
      ? presets.value.filter((p) => p.name.toLowerCase().includes(q))
      : presets.value;
    return list.slice(0, PRESET_RESULT_LIMIT);
  });

  /** 当前高亮的预设（受键盘导航控制），供 Enter 直接选用。 */
  const presetActive = computed<PromptPreset | null>(
    () => presetResults.value[presetActiveIndex.value] ?? null,
  );

  function onComposerPresetChange(payload: { open: boolean; query: string }) {
    presetOpen.value = payload.open;
    presetQuery.value = payload.query;
    if (payload.open) {
      presetActiveIndex.value = 0;
      // 打开时重新读一次存储：管理面板改动后无需额外事件同步
      reloadPresets();
      return;
    }
  }

  function selectPreset(item: PromptPreset) {
    options.insertPreset(item.content);
    presetOpen.value = false;
    presetQuery.value = "";
  }

  function openPresetManager() {
    reloadPresets();
    presetOpen.value = false;
    presetManagerOpen.value = true;
  }

  function closePresetManager() {
    presetManagerOpen.value = false;
  }

  function persist() {
    writePromptPresets(presets.value);
  }

  function addPreset(): PromptPreset {
    const item: PromptPreset = { id: createPromptPresetId(), name: "", content: "" };
    presets.value = [...presets.value, item];
    persist();
    return item;
  }

  function updatePreset(id: string, patch: Partial<Pick<PromptPreset, "name" | "content">>) {
    presets.value = presets.value.map((p) => (p.id === id ? { ...p, ...patch } : p));
    persist();
  }

  function removePreset(id: string) {
    presets.value = presets.value.filter((p) => p.id !== id);
    persist();
  }

  function resetPresetsToDefault() {
    presets.value = DEFAULT_PROMPT_PRESETS.map((p) => ({ ...p }));
    persist();
  }

  /**
   * 输入框 keydown 统一入口。返回 true 表示事件已被预设下拉消费。
   * 下拉未开或无候选时返回 false，把事件让给 `@` 引用链路。
   */
  function onPresetKeydown(e: KeyboardEvent): boolean {
    if (!presetOpen.value || !presetResults.value.length) return false;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      presetActiveIndex.value = (presetActiveIndex.value + 1) % presetResults.value.length;
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      presetActiveIndex.value =
        (presetActiveIndex.value - 1 + presetResults.value.length) % presetResults.value.length;
      return true;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      const item = presetActive.value;
      if (item) selectPreset(item);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      presetOpen.value = false;
      return true;
    }
    return false;
  }

  registerEscapeDismiss(
    presetOpen,
    () => {
      presetOpen.value = false;
    },
    ESCAPE_DISMISS_PRIORITY.PROMPT_PRESET,
  );

  registerEscapeDismiss(
    presetManagerOpen,
    () => {
      presetManagerOpen.value = false;
    },
    ESCAPE_DISMISS_PRIORITY.PROMPT_PRESET,
  );

  return {
    presets,
    presetOpen,
    presetQuery,
    presetActiveIndex,
    presetResults,
    presetActive,
    presetManagerOpen,
    onComposerPresetChange,
    onPresetKeydown,
    selectPreset,
    openPresetManager,
    closePresetManager,
    addPreset,
    updatePreset,
    removePreset,
    resetPresetsToDefault,
  };
}
