import fs from "node:fs";
import path from "node:path";
import { resolveProjectPath } from "./vibeFs";

const MEMORY_USAGE_REL = ".aiall/memory-usage.json";
const MEMORY_USAGE_MAX_ENTRIES = 200;

export type MemoryUsageEntry = {
  key: string;
  count: number;
  lastUsed: string;
};

export type MemoryUsageStore = {
  version: 1;
  entries: MemoryUsageEntry[];
};

function emptyStore(): MemoryUsageStore {
  return { version: 1, entries: [] };
}

function usageAbsPath(projectRoot: string): string | null {
  const resolved = resolveProjectPath(projectRoot, MEMORY_USAGE_REL);
  return resolved.ok ? resolved.path : null;
}

async function readStore(projectRoot: string): Promise<MemoryUsageStore> {
  const abs = usageAbsPath(projectRoot);
  if (!abs) return emptyStore();
  try {
    const raw = await fs.promises.readFile(abs, "utf-8");
    const parsed = JSON.parse(raw) as MemoryUsageStore;
    if (parsed?.version === 1 && Array.isArray(parsed.entries)) return parsed;
  } catch {
    // ENOENT or parse error
  }
  return emptyStore();
}

async function writeStore(projectRoot: string, store: MemoryUsageStore): Promise<void> {
  const abs = usageAbsPath(projectRoot);
  if (!abs) return;
  const dir = path.dirname(abs);
  await fs.promises.mkdir(dir, { recursive: true });
  store.entries = store.entries
    .sort((a, b) => b.count - a.count)
    .slice(0, MEMORY_USAGE_MAX_ENTRIES);
  await fs.promises.writeFile(abs, JSON.stringify(store, null, 2), "utf-8");
}

/** Hash a memory line to a stable key for tracking. */
function memoryLineKey(line: string): string {
  const stripped = line
    .replace(/^- /, "")
    .replace(/^\[[\d-]+\]\s*/, "")
    .trim()
    .toLowerCase();
  let hash = 0;
  for (let i = 0; i < stripped.length; i++) {
    hash = ((hash << 5) - hash + stripped.charCodeAt(i)) | 0;
  }
  return `m${(hash >>> 0).toString(36)}`;
}

/** Extract candidate memory snippets from a memory content string. */
export function extractMemorySnippets(content: string): string[] {
  return content
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) =>
      l
        .replace(/^- /, "")
        .replace(/^\[[\d-]+\]\s*/, "")
        .replace(/`/g, "")
        .trim(),
    )
    .filter((s) => s.length >= 6);
}

/**
 * After an agent run, scan the assistant response for memory references.
 * If a memory snippet appears in the response, mark it as used.
 */
export async function trackMemoryUsage(
  projectRoot: string,
  memoryContent: string,
  assistantResponse: string,
): Promise<void> {
  const snippets = extractMemorySnippets(memoryContent);
  if (!snippets.length) return;

  const responseLower = assistantResponse.toLowerCase();
  const store = await readStore(projectRoot);
  const now = new Date().toISOString();
  let changed = false;

  for (const snippet of snippets) {
    const snippetLower = snippet.toLowerCase();
    if (snippetLower.length < 6) continue;
    if (!responseLower.includes(snippetLower.slice(0, 20))) continue;

    const key = memoryLineKey(snippet);
    const existing = store.entries.find((e) => e.key === key);
    if (existing) {
      existing.count++;
      existing.lastUsed = now;
    } else {
      store.entries.push({ key, count: 1, lastUsed: now });
    }
    changed = true;
  }

  if (changed) {
    await writeStore(projectRoot, store);
  }
}

/** Get usage count for a memory line key. */
export async function getMemoryUsage(
  projectRoot: string,
  line: string,
): Promise<number> {
  const store = await readStore(projectRoot);
  const key = memoryLineKey(line);
  return store.entries.find((e) => e.key === key)?.count ?? 0;
}

/** Get the full usage store for external use. */
export async function getMemoryUsageStore(projectRoot: string): Promise<MemoryUsageStore> {
  return readStore(projectRoot);
}
