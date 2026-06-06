import { ref } from "vue";

const show = ref(false);
const message = ref("");
const confirmText = ref("确定");
const cancelText = ref("取消");
const position = ref({ x: 0, y: 0 });
let resolvePromise: ((value: boolean) => void) | null = null;

export function useConfirm() {
  function confirm(
    msg: string,
    event?: MouseEvent,
    options?: { confirmText?: string; cancelText?: string },
  ): Promise<boolean> {
    return new Promise((resolve) => {
      resolvePromise = resolve;
      message.value = msg;
      confirmText.value = options?.confirmText ?? "确定";
      cancelText.value = options?.cancelText ?? "取消";

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

  function resolve(value: boolean) {
    show.value = false;
    resolvePromise?.(value);
    resolvePromise = null;
  }

  function onConfirm() {
    resolve(true);
  }

  function onCancel() {
    resolve(false);
  }

  return {
    show,
    message,
    confirmText,
    cancelText,
    position,
    confirm,
    onConfirm,
    onCancel,
  };
}
