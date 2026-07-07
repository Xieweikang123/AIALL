/** Fixed keys for minimal project context JSON — Node/Rust must stay in sync. */
export const MINIMAL_PROJECT_CONTEXT_KEYS = [
  "root",
  "languages",
  "runtimes",
  "frameworks",
  "capabilities",
  "entryHints",
  "routes",
] as const;

export type MinimalProjectContextKey = (typeof MINIMAL_PROJECT_CONTEXT_KEYS)[number];

export function assertMinimalProjectContextShape(payload: Record<string, unknown>): void {
  for (const key of MINIMAL_PROJECT_CONTEXT_KEYS) {
    if (!(key in payload)) {
      throw new Error(`missing key: ${key}`);
    }
  }
  for (const key of MINIMAL_PROJECT_CONTEXT_KEYS) {
    if (key === "root") continue;
    if (!Array.isArray(payload[key])) {
      throw new Error(`expected array for ${key}`);
    }
  }
  if (typeof payload.root !== "string") {
    throw new Error("root must be string");
  }
}
