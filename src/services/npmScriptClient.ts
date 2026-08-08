import { reactive } from "vue";
import { invokeBackend, invokeWithChannel, isTauriEnv, WEB_REQUIRES_TAURI_MESSAGE } from "./tauriInvoke";

/** 编辑器底部「脚本运行」面板的全局共享状态（hover 命令与面板组件共用）。 */
export interface NpmScriptRunState {
  visible: boolean;
  running: boolean;
  script: string;
  projectDir: string;
  output: string;
  exitCode: number | null;
  error: string;
  pid: number | null;
}

export const npmScriptRunState = reactive<NpmScriptRunState>({
  visible: false,
  running: false,
  script: "",
  projectDir: "",
  output: "",
  exitCode: null,
  error: "",
  pid: null,
});

const MAX_OUTPUT_CHARS = 200_000;

function appendOutput(text: string) {
  npmScriptRunState.output += text + "\n";
  if (npmScriptRunState.output.length > MAX_OUTPUT_CHARS) {
    npmScriptRunState.output = npmScriptRunState.output.slice(-MAX_OUTPUT_CHARS);
  }
}

/** 从 hover「▶ Run」命令入口启动一个 npm script，输出流式写入共享状态。 */
export function runNpmScript(projectDir: string, script: string): void {
  if (!isTauriEnv()) {
    npmScriptRunState.projectDir = projectDir;
    npmScriptRunState.script = script;
    npmScriptRunState.output = "";
    npmScriptRunState.exitCode = null;
    npmScriptRunState.pid = null;
    npmScriptRunState.running = false;
    npmScriptRunState.error = WEB_REQUIRES_TAURI_MESSAGE;
    npmScriptRunState.visible = true;
    return;
  }

  npmScriptRunState.projectDir = projectDir;
  npmScriptRunState.script = script;
  npmScriptRunState.output = "";
  npmScriptRunState.exitCode = null;
  npmScriptRunState.error = "";
  npmScriptRunState.pid = null;
  npmScriptRunState.running = true;
  npmScriptRunState.visible = true;

  invokeWithChannel(
    "npm_script_run",
    { projectDir, script },
    (event) => {
      const data = (event.data ?? {}) as Record<string, unknown>;
      switch (event.type) {
        case "started":
          npmScriptRunState.pid = typeof data.pid === "number" ? data.pid : null;
          break;
        case "stdout":
        case "stderr":
          if (typeof data.line === "string") appendOutput(data.line);
          break;
        case "finished": {
          npmScriptRunState.running = false;
          npmScriptRunState.exitCode = typeof data.code === "number" ? data.code : -1;
          appendOutput(`[进程退出，退出码 ${npmScriptRunState.exitCode}]`);
          break;
        }
        case "error":
          npmScriptRunState.running = false;
          npmScriptRunState.error = String(data.message ?? "脚本运行失败");
          break;
      }
    },
    async () => {
      npmScriptRunState.running = false;
    },
  ).promise.catch((err: unknown) => {
    npmScriptRunState.running = false;
    npmScriptRunState.error = err instanceof Error ? err.message : String(err);
  });
}

export async function stopNpmScript(): Promise<void> {
  try {
    await invokeBackend("npm_script_stop", {});
  } catch (err) {
    npmScriptRunState.error = err instanceof Error ? err.message : String(err);
  }
}

export function closeNpmScriptPanel(): void {
  npmScriptRunState.visible = false;
}
