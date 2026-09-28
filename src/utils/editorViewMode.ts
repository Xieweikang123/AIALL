import { isMarkdownPath } from "./markdownPreviewPreference";

export type EditorViewMode = "preview" | "edit" | "diff";

/**
 * 编辑器当前视图（三者互斥）。优先级：Diff > md 预览 > 编辑。
 *
 * 抽成纯函数是为了让「同一组输入必得同一视图」可被回归覆盖——
 * 之前视图高亮分散在两个按钮上（文案与高亮语义相反），合成分段控件后
 * 单一真相源就是这里。
 */
export function resolveEditorViewMode(input: {
  path: string;
  showDiffMode: boolean;
  previewEnabled: boolean;
}): EditorViewMode {
  if (input.showDiffMode) return "diff";
  if (input.previewEnabled && isMarkdownPath(input.path)) return "preview";
  return "edit";
}
