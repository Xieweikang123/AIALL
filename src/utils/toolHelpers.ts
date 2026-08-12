/**
 * 工具相关辅助函数
 * 提供工具图标、标签、路径等统一处理
 */

export function getToolIcon(name: string): string {
  if (name === 'read_file') return '📄';
  if (name === 'write_file' || name === 'patch_file') return '🔧';
  if (name === 'grep') return '🔍';
  if (name === 'search_files') return '🔎';
  if (name === 'search_symbols') return '⚡';
  if (name === 'list_dir') return '📁';
  if (name === 'git_status' || name === 'git_diff') return '⎇';
  if (name === 'delete_file') return '🗑️';
  if (name === 'run_command') return '▶️';
  if (name === 'web_search' || name === 'web_extract') return '🌐';
  if (name === 'memory_write') return '🧠';
  if (name === 'search_sessions') return '🕘';
  return '⚡';
}

export function getToolIconClass(name: string): string {
  if (name === 'read_file') return 'read';
  if (name === 'write_file' || name === 'patch_file') return 'write';
  if (name === 'grep' || name === 'search_files' || name === 'search_symbols') return 'search';
  return 'default';
}

export function getToolLabel(name: string): string {
  if (name === 'read_file') return '读取';
  if (name === 'write_file') return '写入';
  if (name === 'patch_file') return '修改';
  if (name === 'grep') return '搜索';
  if (name === 'search_files') return '搜索文件';
  if (name === 'search_symbols') return '搜索符号';
  if (name === 'list_dir') return '列出';
  if (name === 'git_status') return 'Git 状态';
  if (name === 'git_diff') return 'Git diff';
  if (name === 'delete_file') return '删除';
  if (name === 'run_command') return '执行';
  if (name === 'web_search') return '联网搜索';
  if (name === 'web_extract') return '抓取网页';
  if (name === 'memory_write') return '写入记忆';
  if (name === 'search_sessions') return '搜索会话';
  return name;
}

export function getRunCommandText(args?: Record<string, unknown>): string {
  return String(args?.command ?? "").trim().replace(/\s+/g, " ");
}

export function formatRunCommandPreview(command: string, maxLen = 96): string {
  const cmd = command.trim().replace(/\s+/g, " ");
  if (!cmd) return "";
  return cmd.length > maxLen ? `${cmd.slice(0, maxLen)}…` : cmd;
}

export function formatRunCommandLabel(
  args?: Record<string, unknown>,
  detail?: string,
): { preview: string; full: string } {
  const full = getRunCommandText(args) || detail?.trim() || "";
  const preview = formatRunCommandPreview(full, 120) || "（空命令）";
  return { preview, full };
}

const TRIVIAL_COMMAND_OUTPUT = new Set(["（命令执行完成，无输出）"]);

export function parseRunCommandOutputLines(
  raw: string,
  maxLines = 6,
  maxLen = 120,
): string[] {
  const text = raw.trim();
  if (!text || TRIVIAL_COMMAND_OUTPUT.has(text)) return [];

  const lines: string[] = [];
  const body = text.replace(/^命令执行失败：\n?/m, "");
  const sections = body.split(/\n\n+/);

  for (const section of sections) {
    const cleaned = section.replace(/^(stdout|stderr):\n?/i, "").trim();
    if (!cleaned) continue;
    for (const line of cleaned.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || /^exit code:/i.test(trimmed)) continue;
      lines.push(trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}…` : trimmed);
      if (lines.length >= maxLines) return lines;
    }
  }

  if (!lines.length && body.length <= maxLen) return [body];
  if (!lines.length) return [`${body.slice(0, maxLen)}…`];
  return lines;
}

export function getToolPath(step: {
  name?: string;
  args?: Record<string, unknown>;
  detail?: string;
}): string {
  // query 是搜索关键词，不是文件路径（search_files / search_symbols / web_search）
  if (step.name === "search_files" || step.name === "search_symbols" || step.name === "web_search") {
    return "";
  }
  const path = String(
    step.args?.path ?? step.args?.pattern ?? step.detail?.split(' · ')[0] ?? '',
  ).trim();
  return path || '...';
}

export function getToolMeta(step: { summary?: string; ok?: boolean; running?: boolean }): string {
  if (step.running) return '进行中';
  if (step.summary) {
    const match = step.summary.match(/(\d+)/);
    if (match) return match[1] + (step.summary.includes('行') ? ' 行' : step.summary.includes('个') ? ' 个' : '');
  }
  return step.ok === false ? '失败' : '';
}

export function formatToolArgsPreview(name: string, args: Record<string, unknown>): string {
  if (name === "write_file") {
    const path = String(args.path ?? "").trim();
    const content = typeof args.content === "string" ? args.content : "";
    const preview = content.length > 600 ? `${content.slice(0, 600)}\n…（共 ${content.length} 字符）` : content;
    return path ? `路径：${path}\n\n${preview}` : preview;
  }
  if (name === "delete_file") {
    const path = String(args.path ?? "").trim();
    return path ? `将删除：${path}` : "";
  }
  return "";
}

const TRIVIAL_TOOL_RESULTS = new Set(["（无匹配文件）", "（无匹配）", "（空目录）"]);

export function isTrivialToolResult(result?: string): boolean {
  const text = result?.trim() || "";
  if (!text) return true;
  return TRIVIAL_TOOL_RESULTS.has(text);
}

export function shouldShowToolResult(step: { running?: boolean; fullResult?: string }): boolean {
  if (step.running || !step.fullResult?.trim()) return false;
  return !isTrivialToolResult(step.fullResult);
}

export function shouldShowToolExpand(step: { running?: boolean; fullResult?: string; name?: string; args?: Record<string, unknown> }): boolean {
  if (step.running) return false;
  if (step.fullResult?.trim()) return true;
  return Boolean(formatToolArgsPreview(step.name || "", step.args || {}));
}

export function cursorActionClass(step: { running?: boolean; ok?: boolean }): string {
  if (step.running) return 'running';
  if (step.ok === false) return 'error';
  return 'ok';
}

export function formatCollapsedStepsSummary(steps: Array<{ name?: string; args?: Record<string, unknown>; detail?: string }>): string {
  const count = steps.length;
  if (count === 0) return '';
  const first = steps[0];
  if (count === 1) {
    if (first.name === "run_command") {
      const cmd = formatRunCommandPreview(getRunCommandText(first.args));
      return cmd ? `$ ${cmd}` : getToolLabel(first.name || "");
    }
    return `${getToolLabel(first.name || "")} ${getToolPath(first)}`;
  }
  return `${count} 个步骤已折叠`;
}

export type AgentToolStep = {
  id: string;
  name: string;
  icon: string;
  title: string;
  detail: string;
  label: string;
  summary: string;
  ok?: boolean;
  running?: boolean;
  turn?: number;
  lineDelta?: number;
  fullResult?: string;
  args?: Record<string, unknown>;
};
