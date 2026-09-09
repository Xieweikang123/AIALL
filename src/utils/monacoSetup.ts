import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { editor } from "monaco-editor";

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

// 纯黑编辑器主题：底色与全站黑色主题一致，避免编辑器区域出现蓝灰面板底。
editor.defineTheme("aiall-black", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#000000",
    "editorGutter.background": "#000000",
    "minimap.background": "#000000",
    "editor.lineHighlightBackground": "#0d0d0d",
    "editorLineNumber.foreground": "#555555",
    "editorLineNumber.activeForeground": "#999999",
    "editorWidget.background": "#101010",
    "editorSuggestWidget.background": "#101010",
    "editorSuggestWidget.border": "#262626",
    "editorHoverWidget.background": "#101010",
    "editorHoverWidget.border": "#262626",
    "editorOverviewRuler.border": "#000000",
    "scrollbarSlider.background": "#33333380",
    "scrollbarSlider.hoverBackground": "#444444a0",
    "scrollbarSlider.activeBackground": "#555555b0",
    "diffEditor.background": "#000000",
    "diffEditorDiagonal.fill": "#1a1a1a",
    "diffEditor.unchangedRegionBackground": "#0a0a0a",
  },
});