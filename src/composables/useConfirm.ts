import { ref } from "vue";

export type ConfirmThreeResult = "confirm" | "cancel" | "neutral";
export type UnsavedChoice = "save" | "discard" | "cancel";

const show = ref(false);
const message = ref("");
const confirmText = ref("确定");
const cancelText = ref("取消");
const neutralText = ref("");
const position = ref({ x: 0, y: 0 });
let resolvePromise: ((value: boolean) => void) | null = null;
let resolveThreePromise: ((value: ConfirmThreeResult) => void) | null = null;

export function useConfirm() {
  function confirm(
    msg: string,
    event?: MouseEvent,
    options?: { confirmText?: string; cancelText?: string },
  ): Promise<boolean> {
    return new Promise((resolve) => {
      resolvePromise = resolve;
      resolveThreePromise = null;
      message.value = msg;
      confirmText.value = options?.confirmText ?? "确定";
      cancelText.value = options?.cancelText ?? "取消";
      neutralText.value = "";

      if (event) {
        const rect = (event.target as HTMLElement).getBoundingClientRect();
        let x = rect.left + rect.width / 2;
        let y = rect.bottom + 8;
        if (x + 260 > window.innerWidth) x = window.innerWidth - 270;
        if (x < 10) x = 10;
        if (y + 120 > window.innerHeight) y = rect.top - 8;
        position.value = { x, y };
      } else {
        position.value = {
          x: window.innerWidth / 2 - 130,
          y: window.innerHeight / 2 - 60,
        };
      }
      show.value = true;
    });
  }

  function confirmThree(
    msg: string,
    event?: MouseEvent,
    options?: { confirmText?: string; cancelText?: string; neutralText?: string },
  ): Promise<ConfirmThreeResult> {
    return new Promise((resolve) => {
      resolveThreePromise = resolve;
      resolvePromise = null;
      message.value = msg;
      confirmText.value = options?.confirmText ?? "确定";
      cancelText.value = options?.cancelText ?? "取消";
      neutralText.value = options?.neutralText ?? "";

      if (event) {
        const rect = (event.target as HTMLElement).getBoundingClientRect();
        let x = rect.left + rect.width / 2;
        let y = rect.bottom + 8;
        if (x + 260 > window.innerWidth) x = window.innerWidth - 270;
        if (x < 10) x = 10;
        if (y + 120 > window.innerHeight) y = rect.top - 8;
        position.value = { x, y };
      } else {
        position.value = {
          x: window.innerWidth / 2 - 130,
          y: window.innerHeight / 2 - 60,
        };
      }
      show.value = true;
    });
  }

  function confirmUnsaved(
    fileName: string,
    context: "switch" | "close" | "project",
    event?: MouseEvent,
  ): Promise<UnsavedChoice> {
    const hints = {
      switch: "保存 = 保存后切换\n不保存 = 放弃更改并切换\n取消 = 留在当前文件",
      close: "保存 = 保存后关闭\n不保存 = 放弃更改并关闭\n取消 = 留在当前文件",
      project: "保存 = 保存后切换\n不保存 = 放弃更改并切换\n取消 = 留在当前项目",
    };
    return confirmThree(`「${fileName}」未保存。\n\n${hints[context]}`, event, {
      confirmText: "保存",
      neutralText: "不保存",
      cancelText: "取消",
    }).then((result) => {
      if (result === "confirm") return "save";
      if (result === "neutral") return "discard";
      return "cancel";
    });
  }

  function resolve(value: boolean) {
    show.value = false;
    resolvePromise?.(value);
    resolvePromise = null;
  }

  function resolveThree(value: ConfirmThreeResult) {
    show.value = false;
    resolveThreePromise?.(value);
    resolveThreePromise = null;
  }

  function onConfirm() {
    if (resolveThreePromise) {
      resolveThree("confirm");
      return;
    }
    resolve(true);
  }

  function onCancel() {
    if (resolveThreePromise) {
      resolveThree("cancel");
      return;
    }
    resolve(false);
  }

  function onNeutral() {
    resolveThree("neutral");
  }

  /** HMR / 重载后关闭可能残留的遮罩，避免全屏拦截点击。 */
  function dismissPendingOverlay() {
    show.value = false;
    resolvePromise?.(false);
    resolvePromise = null;
    resolveThreePromise?.("cancel");
    resolveThreePromise = null;
  }

  return {
    show,
    message,
    confirmText,
    cancelText,
    neutralText,
    position,
    confirm,
    confirmThree,
    confirmUnsaved,
    onConfirm,
    onCancel,
    onNeutral,
    dismissPendingOverlay,
  };
}
