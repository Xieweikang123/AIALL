import { ref } from "vue";

const show = ref(false);
const title = ref("");
const defaultValue = ref("");
const placeholder = ref("");
const confirmText = ref("确定");
const cancelText = ref("取消");
let resolvePromise: ((value: string | null) => void) | null = null;

export function useInputPrompt() {
  function prompt(
    msg: string,
    options?: { defaultValue?: string; placeholder?: string; confirmText?: string; cancelText?: string },
  ): Promise<string | null> {
    return new Promise((resolve) => {
      resolvePromise = resolve;
      title.value = msg;
      defaultValue.value = options?.defaultValue ?? "";
      placeholder.value = options?.placeholder ?? "";
      confirmText.value = options?.confirmText ?? "确定";
      cancelText.value = options?.cancelText ?? "取消";
      show.value = true;
    });
  }

  function resolve(value: string | null) {
    show.value = false;
    resolvePromise?.(value);
    resolvePromise = null;
  }

  function onConfirm(inputValue: string) {
    resolve(inputValue.trim() || null);
  }

  function onCancel() {
    resolve(null);
  }

  /** HMR / 重载后关闭可能残留的遮罩，避免全屏拦截点击。 */
  function dismissPendingOverlay() {
    show.value = false;
    resolvePromise?.(null);
    resolvePromise = null;
  }

  return {
    show,
    title,
    defaultValue,
    placeholder,
    confirmText,
    cancelText,
    prompt,
    onConfirm,
    onCancel,
    dismissPendingOverlay,
  };
}
