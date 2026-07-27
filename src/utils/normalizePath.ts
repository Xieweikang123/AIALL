export function normalizeProjectPath(projectPath: string): string {
  return projectPath.trim().replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
}

export function normalizePath(projectPath: string): string {
  return projectPath.trim().replace(/\\/g, "/").replace(/[/\\]+$/, "");
}
