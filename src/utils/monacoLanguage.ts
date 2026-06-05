const EXT_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".vue": "html",
  ".json": "json",
  ".jsonc": "json",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".html": "html",
  ".htm": "html",
  ".xml": "xml",
  ".svg": "xml",
  ".md": "markdown",
  ".mdx": "markdown",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".sql": "sql",
  ".sh": "shell",
  ".bash": "shell",
  ".ps1": "powershell",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".swift": "swift",
  ".kt": "kotlin",
  ".lua": "lua",
  ".toml": "ini",
  ".ini": "ini",
  ".dockerfile": "dockerfile",
  ".env": "ini",
};

const NAME_LANG: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  ".gitignore": "ini",
  ".editorconfig": "ini",
};

export function languageFromFilePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const base = normalized.split("/").pop() || "";
  const lower = base.toLowerCase();

  if (NAME_LANG[lower]) return NAME_LANG[lower];

  const dot = lower.lastIndexOf(".");
  if (dot <= 0) return "plaintext";

  const ext = lower.slice(dot);
  return EXT_LANG[ext] || "plaintext";
}
