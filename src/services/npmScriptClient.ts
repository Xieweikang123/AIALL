import { reactive } from "vue";
import { invokeBackend, invokeWithChannel, isTauriEnv, WEB_REQUIRES_TAURI_MESSAGE } from "./tauriInvoke";

export type NpmScriptLineKind = "stdout" | "stderr" | "system";

export interface NpmScriptOutputLine {
  kind: NpmScriptLineKind;
  text: string;
}

/** 编辑器底部「脚本运行」面板的全局共享状态（hover 命令与面板组件共用）。 */
export interface NpmScriptRunState {
  visible: boolean;
  running: boolean;
  script: string;
  projectDir: string;
  lines: NpmScriptOutputLine[];
  exitCode: number | null;
  error: string;
  pid: number | null;
  startedAt: number;
  finishedAt: number;
}

export const npmScriptRunState = reactive<NpmScriptRunState>({
  visible: false,
  running: false,
  script: "",
  projectDir: "",
  lines: [],
  exitCode: null,
  error: "",
  pid: null,
  startedAt: 0,
  finishedAt: 0,
});

const MAX_LINES = 2000;

function appendLine(kind: NpmScriptLineKind, text: string) {
  for (const part of text.split(/\r?\n/)) {
    npmScriptRunState.lines.push({ kind, text: part });
  }
  if (npmScriptRunState.lines.length > MAX_LINES) {
    npmScriptRunState.lines.splice(0, npmScriptRunState.lines.length - MAX_LINES);
  }
}

/** 从 hover「▶ Run」命令入口启动一个 npm script，输出流式写入共享状态。 */
export function runNpmScript(projectDir: string, script: string): void {
  if (!isTauriEnv()) {
    npmScriptRunState.projectDir = projectDir;
    npmScriptRunState.script = script;
    npmScriptRunState.lines = [];
    npmScriptRunState.exitCode = null;
    npmScriptRunState.pid = null;
    npmScriptRunState.running = false;
    npmScriptRunState.error = WEB_REQUIRES_TAURI_MESSAGE;
    npmScriptRunState.startedAt = 0;
    npmScriptRunState.finishedAt = 0;
    npmScriptRunState.visible = true;
    return;
  }

  npmScriptRunState.projectDir = projectDir;
  npmScriptRunState.script = script;
  npmScriptRunState.lines = [];
  npmScriptRunState.exitCode = null;
  npmScriptRunState.error = "";
  npmScriptRunState.pid = null;
  npmScriptRunState.running = true;
  npmScriptRunState.visible = true;
  npmScriptRunState.startedAt = Date.now();
  npmScriptRunState.finishedAt = 0;

  appendLine("system", `$ npm run ${script}`);

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
          if (typeof data.line === "string") appendLine("stdout", data.line);
          break;
        case "stderr":
          if (typeof data.line === "string") appendLine("stderr", data.line);
          break;
        case "finished": {
          npmScriptRunState.running = false;
          npmScriptRunState.finishedAt = Date.now();
          npmScriptRunState.exitCode = typeof data.code === "number" ? data.code : -1;
          appendLine("system", `[进程退出，退出码 ${npmScriptRunState.exitCode}]`);
          break;
        }
        case "error":
          npmScriptRunState.running = false;
          npmScriptRunState.finishedAt = Date.now();
          npmScriptRunState.error = String(data.message ?? "脚本运行失败");
          appendLine("system", `[运行失败] ${npmScriptRunState.error}`);
          break;
      }
    },
    async () => {
      npmScriptRunState.running = false;
      npmScriptRunState.finishedAt = Date.now();
    },
  ).promise.catch((err: unknown) => {
    npmScriptRunState.running = false;
    npmScriptRunState.finishedAt = Date.now();
    npmScriptRunState.error = err instanceof Error ? err.message : String(err);
    appendLine("system", `[运行失败] ${npmScriptRunState.error}`);
  });
}

export async function stopNpmScript(): Promise<void> {
  try {
    await invokeBackend("npm_script_stop", {});
  } catch (err) {
    npmScriptRunState.error = err instanceof Error ? err.message : String(err);
  }
}

export function clearNpmScriptOutput(): void {
  npmScriptRunState.lines = [];
  npmScriptRunState.exitCode = null;
  npmScriptRunState.error = "";
  npmScriptRunState.startedAt = 0;
  npmScriptRunState.finishedAt = 0;
}

export function closeNpmScriptPanel(): void {
  npmScriptRunState.visible = false;
}
