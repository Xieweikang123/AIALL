/**
 * Generic probe / introspect guardrails (Tier 2 mechanism).
 * No business-specific terms — path patterns and payload shapes only.
 */

export const STRUCTURED_ASSET_PROBE_TURN_BUDGET = 2;

export function normalizeProbePath(path: string): string {
  return path.replace(/\\/g, "/").trim();
}

/** Temporary artifacts created during environment/schema probing. */
export function isEphemeralProbePath(path: string): boolean {
  const p = normalizeProbePath(path);
  if (/^\.aiall\/probe\//i.test(p)) return true;
  if (/^(schema|dump|temp|test_connection|probe)[^/]*\.(json|sql|txt|py|js|ts|cs|sh)$/i.test(p)) return true;
  if (/_(result|dump|schema)\.json$/i.test(p)) return true;
  return false;
}

export function isProbeScriptPath(path: string): boolean {
  return /^\.aiall\/probe\//i.test(normalizeProbePath(path));
}

const SCHEMA_PAYLOAD_MARKERS = [
  "TABLE_NAME",
  "COLUMN_NAME",
  "information_schema",
  "INFORMATION_SCHEMA",
  "tableCount",
  '"schema"',
  "'schema'",
] as const;

export function looksLikeStructuredSchemaPayload(text: string): boolean {
  const t = text.trim();
  if (t.length < 40) return false;
  let hits = 0;
  for (const marker of SCHEMA_PAYLOAD_MARKERS) {
    if (t.includes(marker)) hits += 1;
  }
  if (t.includes("TABLE_NAME") && t.includes("COLUMN_NAME")) return true;
  return hits >= 2;
}

export function countSchemaTablesInPayload(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed.tableCount === "number" && Number.isFinite(parsed.tableCount)) {
      return parsed.tableCount;
    }
    if (Array.isArray(parsed.schema)) return parsed.schema.length;
    if (Array.isArray(parsed.tables)) return parsed.tables.length;
  } catch {
    // fall through to heuristics
  }
  const tableNameKeys = trimmed.match(/"tableName"\s*:/g);
  if (tableNameKeys?.length) return tableNameKeys.length;
  return null;
}

export function isIntrospectBusinessRoutePatch(
  filePath: string,
  oldString: string,
  newString: string,
): boolean {
  const p = normalizeProbePath(filePath);
  const isBusinessEntry =
    /(^|\/)controllers?\//i.test(p) ||
    /(^|\/)routes?\//i.test(p) ||
    /Controller\.(cs|ts|js|py|go|rb)$/i.test(p) ||
    /(^|\/)handlers?\//i.test(p);
  if (!isBusinessEntry) return false;

  const addsRoute =
    /\[(HttpGet|HttpPost|HttpPut|HttpDelete|Route)\s*\(/i.test(newString) ||
    /\.(MapGet|MapPost|MapPut|MapDelete)\s*\(/i.test(newString);
  if (!addsRoute) return false;

  const combined = `${oldString}\n${newString}`;
  return /information_schema|INFORMATION_SCHEMA|GetTableInfo|DbMaintenance|schema-db|table-columns|introspect|TABLE_SCHEMA/i.test(
    combined,
  );
}

export function buildIntrospectProbeBlockedMessage(): string {
  return [
    "错误：禁止为临时自省/拉取外部元数据而修改业务 Controller 或路由。",
    "请改用 run_command 执行一次性 CLI，或在 `.aiall/probe/` 下创建跑完即自动退出的独立脚本。",
    "禁止通过启动常驻服务并用 HTTP 自调用的方式探测环境。",
  ].join("");
}

export function buildProbeIntrospectAntiPatternHint(): string {
  return [
    "25. 外部环境只读探测（通用）：",
    "临时 introspect、连接外部资源、拉取 schema/元数据时，禁止 patch 业务 Controller/路由/常驻服务；",
    "必须优先 run_command 一次性 CLI，或在 `.aiall/probe/` 写跑完即删的独立脚本；",
    "禁止 dotnet run / npm start + curl 调自身接口来做探测（除非用户明确要求新增 API）。",
    "探测完成后 delete_file 清理 `.aiall/probe/` 与根目录临时 json/sql，再写业务交付代码。",
  ].join("\n");
}

export function buildStructuredAssetWriteNudge(tableCount?: number | null): string {
  const detail =
    tableCount != null && tableCount > 0 ? `（约 ${tableCount} 个结构单元）` : "";
  return [
    `【系统提示】检测到你已成功获取核心结构数据${detail}。`,
    "请立刻停止 run_command / 控制台编码排查 / HTTP 探测。",
    "当前最高优先级：根据已有数据 write_file 或 patch_file 生成/修改业务代码。",
    "若仅为探测曾写入 `.aiall/probe/` 或临时 json，生成代码后须 delete_file 清理。",
  ].join("");
}

export function buildWorkspaceCleanupNudge(uncleanedPaths: string[]): string {
  const list = uncleanedPaths.slice(0, 6).join("、");
  const extra = uncleanedPaths.length > 6 ? ` 等 ${uncleanedPaths.length} 个` : "";
  return [
    "【系统提示】本轮仍留有探测临时文件或未清理的辅助产物：",
    `${list}${extra}`,
    "在最终向用户宣告完成前，必须 delete_file 删除临时文件。",
    "清理完成后再输出总结。",
  ].join("\n");
}

export function isProbeExploreToolName(name: string): boolean {
  return (
    name === "run_command" ||
    name === "grep" ||
    name === "search_files" ||
    name === "read_file" ||
    name === "list_dir" ||
    name === "web_search" ||
    name === "web_extract"
  );
}

export function isProductiveDeliverableWrite(name: string, filePath: string): boolean {
  if (name !== "write_file" && name !== "patch_file") return false;
  const p = normalizeProbePath(filePath);
  if (!p) return false;
  if (isProbeScriptPath(p) || isEphemeralProbePath(p)) return false;
  return true;
}

export type AbortSummaryTool = {
  name?: string;
  ok?: boolean;
  running?: boolean;
  summary?: string;
  args?: Record<string, unknown>;
};

export function buildAbortExitSummary(input: {
  tools?: AbortSummaryTool[];
  writtenFiles?: string[];
}): string | null {
  const tools = input.tools?.filter((t) => !t.running) ?? [];
  if (!tools.length) return null;

  const completed: string[] = [];
  const pending: string[] = [];

  let schemaTableCount: number | null = null;
  for (const tool of tools) {
    if (tool.ok !== true) continue;
    const summary = tool.summary?.trim() ?? "";
    if (tool.name === "run_command" && looksLikeStructuredSchemaPayload(summary)) {
      schemaTableCount = countSchemaTablesInPayload(summary) ?? schemaTableCount;
    }
    if (tool.name === "write_file" || tool.name === "read_file") {
      const path = normalizeProbePath(String(tool.args?.path ?? ""));
      if (path && isEphemeralProbePath(path)) {
        completed.push(`已落盘临时结构文件 \`${path}\``);
      }
    }
    if (tool.name === "patch_file" && tool.ok) {
      const path = normalizeProbePath(String(tool.args?.path ?? ""));
      if (/(^|\/)controllers?\//i.test(path) || /Controller\./i.test(path)) {
        completed.push(`已修改业务入口文件 \`${path}\`（可能含探测性改动）`);
      }
    }
  }

  const readTools = tools.filter((t) => t.name === "read_file" && t.ok);
  if (readTools.length) {
    completed.push(`已 read ${readTools.length} 个文件`);
  }

  if (schemaTableCount != null && schemaTableCount > 0) {
    completed.push(`已获取外部结构数据（约 ${schemaTableCount} 个表/结构单元）`);
  } else if (
    tools.some(
      (t) =>
        t.ok &&
        t.name === "run_command" &&
        looksLikeStructuredSchemaPayload(t.summary ?? ""),
    )
  ) {
    completed.push("已获取外部结构数据");
  }

  const written = (input.writtenFiles ?? []).map(normalizeProbePath);
  const ephemeralWritten = written.filter(isEphemeralProbePath);
  const deliverableWrites = written.filter(
    (p) => p && !isEphemeralProbePath(p) && !isProbeScriptPath(p),
  );
  const hasDeliverableEntityDir = deliverableWrites.some((p) => /(^|\/)models?\//i.test(p));

  if (
    (schemaTableCount != null ||
      tools.some((t) => t.ok && t.name === "run_command" && looksLikeStructuredSchemaPayload(t.summary ?? ""))) &&
    !hasDeliverableEntityDir
  ) {
    pending.push("尚未根据结构数据生成业务实体/模型代码");
  }

  if (ephemeralWritten.length) {
    pending.push(`临时探测文件未清理：${ephemeralWritten.join("、")}`);
  }

  const successfulBuild = tools.some(
    (t) => t.ok && t.name === "run_command" && /build succeeded|已成功生成|Build succeeded/i.test(t.summary ?? ""),
  );
  if (successfulBuild && pending.some((p) => p.includes("实体"))) {
    completed.push("项目已成功编译");
  }

  if (!completed.length && !pending.length) return null;

  const resumeHint = pending.some((p) => p.includes("实体"))
    ? "根据已有结构数据生成 Models/实体类，并 delete_file 清理临时探测文件。"
    : pending.some((p) => p.includes("未清理"))
      ? "继续完成主任务并 delete_file 清理临时探测文件。"
      : "点击「恢复运行」从断点继续。";

  return [
    "## 运行中断摘要",
    "",
    "### 已完成",
    ...(completed.length ? completed.map((line) => `- ${line}`) : ["- 暂无明确阶段产出"]),
    "",
    "### 未完成",
    ...(pending.length ? pending.map((line) => `- ${line}`) : ["- 最终回复与清理"]),
    "",
    "### 恢复建议",
    resumeHint,
  ].join("\n");
}
