import { lsGet, lsSetJson } from "../utils/localStorageSafe";
import { normalizeProjectPath } from "../utils/normalizePath";

export type ProjectHistoryEntry = {
  path: string;
  displayName: string;
  lastOpenedAt: string;
};

const STORAGE_KEY = "vibe-coding-project-history";
const STORE_VERSION = 1;
const MAX_ENTRIES = 50;

type ProjectHistoryStore = {
  version: typeof STORE_VERSION;
  entries: ProjectHistoryEntry[];
};

function normalizePathKey(path: string): string {
  return normalizeProjectPath(path);
}

function displayNameFromPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/").replace(/\/$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function readStore(): ProjectHistoryStore {
  const raw = lsGet(STORAGE_KEY);
  if (!raw) return { version: STORE_VERSION, entries: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<ProjectHistoryStore>;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.entries)) {
      return { version: STORE_VERSION, entries: [] };
    }
    return {
      version: STORE_VERSION,
      entries: parsed.entries.filter(
        (e): e is ProjectHistoryEntry =>
          Boolean(e) &&
          typeof e.path === "string" &&
          e.path.trim().length > 0 &&
          typeof e.lastOpenedAt === "string",
      ),
    };
  } catch {
    return { version: STORE_VERSION, entries: [] };
  }
}

function writeStore(store: ProjectHistoryStore) {
  lsSetJson(STORAGE_KEY, store);
}

export function listProjectHistory(): ProjectHistoryEntry[] {
  return readStore().entries;
}

export function addProjectToHistory(path: string) {
  const trimmed = path.trim();
  if (!trimmed) return;

  const key = normalizePathKey(trimmed);
  if (!key) return;

  const store = readStore();
  const now = new Date().toISOString();
  const displayName = displayNameFromPath(trimmed);
  const existing = store.entries.find((e) => normalizePathKey(e.path) === key);

  if (existing) {
    existing.path = trimmed;
    existing.displayName = displayName;
    existing.lastOpenedAt = now;
    store.entries = [existing, ...store.entries.filter((e) => normalizePathKey(e.path) !== key)];
  } else {
    store.entries.unshift({ path: trimmed, displayName, lastOpenedAt: now });
  }

  if (store.entries.length > MAX_ENTRIES) {
    store.entries = store.entries.slice(0, MAX_ENTRIES);
  }

  writeStore(store);
}

export function removeProjectFromHistory(path: string) {
  const key = normalizePathKey(path);
  if (!key) return;

  const store = readStore();
  store.entries = store.entries.filter((e) => normalizePathKey(e.path) !== key);
  writeStore(store);
}

export function clearProjectHistory() {
  writeStore({ version: STORE_VERSION, entries: [] });
}
