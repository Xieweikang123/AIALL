import { ref, type Ref } from "vue";
import { runEditorInlineAi } from "../services/editorInlineAi";
import { languageFromFilePath } from "../utils/monacoLanguage";

export interface EditorInlineAiDeps {
  aiConfig: Ref<{ endpoint: string; apiKey: string; model: string }>;
  configReady: Ref<boolean>;
  activeFilePath: Ref<string>;
  fileContent: Ref<string>;
  getSelectedText: () => string;
  replaceSelection: (text: string) => boolean;
}

export function useEditorInlineAi(deps: EditorInlineAiDeps) {
  const open = ref(false);
  const instruction = ref("");
  const loading = ref(false);
  const preview = ref("");
  const error = ref("");
  const anchorTop = ref(120);
  const anchorLeft = ref(120);

  function openPanel(anchor?: { top: number; left: number }) {
    if (!deps.configReady.value) {
      error.value = "请先在 AI 配置页设置模型";
      open.value = true;
      return;
    }
    instruction.value = "";
    preview.value = "";
    error.value = "";
    if (anchor) {
      anchorTop.value = anchor.top;
      anchorLeft.value = anchor.left;
    }
    open.value = true;
  }

  function closePanel() {
    if (loading.value) return;
    open.value = false;
    instruction.value = "";
    preview.value = "";
    error.value = "";
  }

  async function submitInstruction() {
    const text = instruction.value.trim();
    if (!text || loading.value) return;
    loading.value = true;
    error.value = "";
    preview.value = "";
    try {
      const result = await runEditorInlineAi({
        endpoint: deps.aiConfig.value.endpoint,
        apiKey: deps.aiConfig.value.apiKey || undefined,
        model: deps.aiConfig.value.model,
        filePath: deps.activeFilePath.value,
        language: languageFromFilePath(deps.activeFilePath.value),
        selectedText: deps.getSelectedText(),
        fullContent: deps.fileContent.value,
        instruction: text,
        onStreamChunk: (chunk) => {
          preview.value += chunk;
        },
      });
      if (!result.ok) {
        error.value = result.error || "生成失败";
        return;
      }
      preview.value = result.replacement || preview.value;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "生成失败";
    } finally {
      loading.value = false;
    }
  }

  function acceptPreview() {
    const text = preview.value.trim();
    if (!text) return;
    const ok = deps.replaceSelection(text);
    if (!ok) {
      error.value = "无法写入编辑器";
      return;
    }
    closePanel();
  }

  return {
    open,
    instruction,
    loading,
    preview,
    error,
    anchorTop,
    anchorLeft,
    openPanel,
    closePanel,
    submitInstruction,
    acceptPreview,
  };
}
