/**
 * 工具相关辅助函数
 * 提供工具图标、标签、路径等统一处理
 */

export function getToolIcon(name: string): string {
  if (name === 'read_file') return '📄';
  if (name === 'write_file' || name === 'patch_file') return '🔧';
  if (name === 'grep') return '🔍';
  if (name === 'search_files') return '🔎';
  if (name === 'list_dir') return '📁';
  if (name === 'delete_file') return '🗑️';
  if (name === 'run_command') return '▶️';
  if (name === 'web_search' || name === 'web_extract') return '🌐';
  return '⚡';
}

export function getToolIconClass(name: string): string {
  if (name === 'read_file') return 'read';
  if (name === 'write_file' || name === 'patch_file') return 'write';
  if (name === 'grep' || name === 'search_files') return 'search';
  return 'default';
}

export function getToolLabel(name: string): string {
  if (name === 'read_file') return '读取';
  if (name === 'write_file') return '写入';
  if (name === 'patch_file') return '修改';
  if (name === 'grep') return '搜索';
  if (name === 'search_files') return '搜索文件';
  if (name === 'list_dir') return '列出';
  if (name === 'delete_file') return '删除';
  if (name === 'run_command') return '执行';
  if (name === 'web_search') return '联网搜索';
  if (name === 'web_extract') return '抓取网页';
  return name;
}

export function getToolPath(step: { args?: Record<string, unknown>; detail?: string }): string {
  const path = String(step.args?.path ?? step.args?.pattern ?? step.args?.query ?? step.detail?.split(' · ')[0] ?? '').trim();
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
  if (count === 1) return `${getToolLabel(first.name || "")} ${getToolPath(first)}`;
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
  ok: boolean;
  running?: boolean;
  turn?: number;
  lineDelta?: number;
  fullResult?: string;
  args?: Record<string, unknown>;
};
