import { lsGet, lsSet } from "./localStorageSafe";

/**
 * Markdown 预览开关是**全局偏好**（localStorage 持久化），不是 per-tab 状态：
 * 打开任意 md 都按它决定「预览 / 编辑」，切到非 md 自动退出。
 *
 * 之所以放在共享工具里而不是留在 `EditorPanel.vue`：编辑器打开 git 变更文件
 * （diff 预览）时，需要读这个偏好来决定要不要让位给预览（见 `useEditorPanel` 的
 * `openDiffPreview`），两边必须读同一个 key。
 */
export const MARKDOWN_PREVIEW_STORAGE_KEY = "editor-md-preview";

export function isMarkdownPath(path: string): boolean {
  return /\.md$/i.test(path);
}

export function loadMarkdownPreviewEnabled(): boolean {
  return lsGet(MARKDOWN_PREVIEW_STORAGE_KEY) === "true";
}

export function saveMarkdownPreviewEnabled(enabled: boolean): void {
  lsSet(MARKDOWN_PREVIEW_STORAGE_KEY, String(enabled));
}
