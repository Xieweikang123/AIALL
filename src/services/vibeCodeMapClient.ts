import {
  CODE_MAP_LATEST_REL,
  CODE_MAP_LAYOUT_REL,
  isCodeMapDocument,
  isCodeMapLayoutFile,
  type CodeMapBuildResult,
  type CodeMapDocument,
  type CodeMapLayoutFile,
} from "../../shared/codeMapTypes";
import { formatFetchError, readFile, writeFile } from "./vibeCodingClient";
import { formatInvokeError, invokeBackend, isTauriEnv, WEB_REQUIRES_TAURI_MESSAGE } from "./tauriInvoke";

function isMissingFileError(message?: string): boolean {
  return Boolean(message && /不存在|not found|ENOENT/i.test(message));
}

export async function buildCodeMap(
  projectPath: string,
  gitHead?: string,
): Promise<CodeMapBuildResult> {
  const root = projectPath.trim();
  if (!root) return { ok: false, error: "未打开项目" };
  try {
    const result = await invokeBackend<CodeMapBuildResult>("code_map_build", {
      projectPath: root,
      gitHead: gitHead || null,
    });
    if (!result?.ok || !isCodeMapDocument(result.document)) {
      return { ok: false, error: result?.error || "架构图生成失败" };
    }
    return { ok: true, document: result.document };
  } catch (error) {
    if (!isTauriEnv()) {
      return { ok: false, error: WEB_REQUIRES_TAURI_MESSAGE };
    }
    return { ok: false, error: formatInvokeError(error, "架构图生成失败") };
  }
}

export async function fetchCodeMap(projectPath: string): Promise<{
  ok: boolean;
  document?: CodeMapDocument;
  missing?: boolean;
  error?: string;
}> {
  const read = await readFile(CODE_MAP_LATEST_REL, projectPath);
  if (!read.ok) {
    if (isMissingFileError(read.error)) {
      return { ok: true, missing: true };
    }
    return { ok: false, error: read.error || "读取架构图失败" };
  }
  try {
    const parsed = JSON.parse(read.content) as unknown;
    if (!isCodeMapDocument(parsed)) {
      return { ok: false, error: "架构图缓存格式无效" };
    }
    return { ok: true, document: parsed };
  } catch {
    return { ok: false, error: "架构图缓存解析失败" };
  }
}

export async function saveCodeMap(
  projectPath: string,
  document: CodeMapDocument,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const content = `${JSON.stringify(document, null, 2)}\n`;
    const written = await writeFile(CODE_MAP_LATEST_REL, content, projectPath);
    if (!written.ok) {
      return { ok: false, error: written.error || "保存架构图失败" };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: formatFetchError(error, "保存架构图失败") };
  }
}

export async function fetchCodeMapLayout(projectPath: string): Promise<{
  ok: boolean;
  layout?: CodeMapLayoutFile;
  missing?: boolean;
  error?: string;
}> {
  const read = await readFile(CODE_MAP_LAYOUT_REL, projectPath);
  if (!read.ok) {
    if (isMissingFileError(read.error)) {
      return { ok: true, missing: true };
    }
    return { ok: false, error: read.error || "读取布局失败" };
  }
  try {
    const parsed = JSON.parse(read.content) as unknown;
    if (!isCodeMapLayoutFile(parsed)) {
      return { ok: false, error: "布局文件格式无效" };
    }
    return { ok: true, layout: parsed };
  } catch {
    return { ok: false, error: "布局文件解析失败" };
  }
}

export async function saveCodeMapLayout(
  projectPath: string,
  layout: CodeMapLayoutFile,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const content = `${JSON.stringify(layout, null, 2)}\n`;
    const written = await writeFile(CODE_MAP_LAYOUT_REL, content, projectPath);
    if (!written.ok) {
      return { ok: false, error: written.error || "保存布局失败" };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: formatFetchError(error, "保存布局失败") };
  }
}
