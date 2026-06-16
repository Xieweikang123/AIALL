export function debugLog(...args: unknown[]) {
  const line = `[${new Date().toISOString()}] ${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")}`;
  fetch("/backend/vibe/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: ".debug.log", line }),
  }).catch(() => {});
}
