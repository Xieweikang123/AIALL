import { invokeBackend } from "./tauriInvoke";
import { readFile, writeFile } from "./vibeCodingClient";

export type LongTermMemoryEntry = {
  id: string;
  content: string;
  scope: string;
  source?: string;
  createdAt: string;
  updatedAt: string;
  confidence: number;
  supersededBy?: string;
  active: boolean;
};

export type LongTermMemoryPayload = {
  ok: boolean;
  entries?: LongTermMemoryEntry[];
  error?: string;
};

export type LongTermMemoryDeletePayload = {
  ok: boolean;
  deleted?: boolean;
  error?: string;
};

const MEMORY_INDEX_REL = ".aiall/memory/index.json";

const SCOPE_LABELS: Record<string, string> = {
  architecture: "架构",
  decision: "决策",
  preference: "偏好",
  fact: "事实",
};

export function longTermMemoryScopeLabel(scope: string): string {
  return SCOPE_LABELS[scope] ?? scope;
}

function isMissingFileError(message?: string): boolean {
  return Boolean(message && /不存在|not found|ENOENT/i.test(message));
}

async function fetchViaFileApi(projectPath: string): Promise<LongTermMemoryPayload> {
  const read = await readFile(MEMORY_INDEX_REL, projectPath);
  if (!read.ok) {
    if (isMissingFileError(read.error)) {
      return { ok: true, entries: [] };
    }
    return { ok: false, error: read.error || "读取长期记忆失败" };
  }
  try {
    const parsed = JSON.parse(read.content || "{}");
    const entries: LongTermMemoryEntry[] = Array.isArray(parsed.entries) ? parsed.entries : [];
    entries.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    return { ok: true, entries };
  } catch {
    return { ok: false, error: "长期记忆文件解析失败" };
  }
}

export async function fetchLongTermMemory(projectPath: string): Promise<LongTermMemoryPayload> {
  const trimmed = projectPath.trim();
  if (!trimmed) return { ok: false, error: "缺少 projectPath" };
  return invokeBackend<LongTermMemoryPayload>(
    "memory_list",
    { projectPath: trimmed },
    async () => fetchViaFileApi(trimmed),
  );
}

async function deleteViaFileApi(
  projectPath: string,
  id: string,
): Promise<LongTermMemoryDeletePayload> {
  const read = await readFile(MEMORY_INDEX_REL, projectPath);
  if (!read.ok) {
    if (isMissingFileError(read.error)) {
      return { ok: true, deleted: false };
    }
    return { ok: false, error: read.error || "读取长期记忆失败" };
  }
  try {
    const parsed = JSON.parse(read.content || "{}");
    const entries: LongTermMemoryEntry[] = Array.isArray(parsed.entries) ? parsed.entries : [];
    const next = entries.filter((e) => e.id !== id);
    if (next.length === entries.length) {
      return { ok: true, deleted: false };
    }
    const write = await writeFile(MEMORY_INDEX_REL, JSON.stringify({ version: 1, entries: next }), projectPath);
    if (!write.ok) {
      return { ok: false, error: write.error || "删除长期记忆失败" };
    }
    return { ok: true, deleted: true };
  } catch {
    return { ok: false, error: "长期记忆文件解析失败" };
  }
}

export async function deleteLongTermMemoryEntry(
  projectPath: string,
  id: string,
): Promise<LongTermMemoryDeletePayload> {
  const trimmed = projectPath.trim();
  if (!trimmed) return { ok: false, error: "缺少 projectPath" };
  if (!id.trim()) return { ok: false, error: "缺少记忆 id" };
  return invokeBackend<LongTermMemoryDeletePayload>(
    "memory_delete",
    { projectPath: trimmed, id },
    async () => deleteViaFileApi(trimmed, id),
  );
}
