import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import type { VibeChatMode } from "../shared/agentTypes";
import {
  applyUniquePatch,
  grepInProject,
  listDirectory,
  readFileContent,
  resolveProjectPath,
  resolveReadablePath,
  searchFiles,
  sliceFileLines,
  writeFileContent,
  type RunExtractOutcome,
} from "./vibeFs";
import {
  buildIntrospectProbeBlockedMessage,
  isIntrospectBusinessRoutePatch,
} from "../shared/agentProbeGuard";
import { runWebExtract, runWebSearch } from "./webExtract";
import {
  appendProjectMemory,
  isProjectMemorySection,
} from "./vibeProjectMemory";
import {
  buildSkillProposalToolResult,
} from "./projectSkillProposal";
import {
  listProjectSkills,
  readProjectSkill,
} from "./vibeProjectSkills";
import {
  invalidateProjectContextCache,
  formatInjectedKeyFileReadNudge,
} from "./vibeProjectContext";
import { buildSearchFilesEmptyHint } from "./agentAskPrompt";
import { runGitDiffTool, runGitStatusTool } from "./agentGitTools";
import { buildWriteToolBlockedMessage } from "../src/services/agentUserIntent";
import {
  MAX_READ_SLICE_REPEATS,
  isExplorationArchivePath,
  buildExplorationArchiveWriteBlockedMessage,
} from "./agentExplorationBudget";
import {
  buildPlanDocumentBuildModeBlockedMessage,
  isPlanDocumentPath,
} from "../shared/planFilePath";
import {
  checkOverlappingRead,
  checkPatchOldStringFromReads,
  consumePatchRecoveryRead,
  invalidateFileReadState,
  isBlockedGrepAfterLocate,
  isBlockedGrepAfterVisionMisread,
  isLowSignalVisionLocateGrep,
  isOverlyBroadVisionGrep,
  isSearchFilesContentQuery,
  markPatchRecoveryFile,
  readLineRangeFromArgs,
  recordReadRange,
  buildBlockedGrepMessage,
  buildBlockedGrepAfterLocateMessage,
  buildLowSignalVisionLocateGrepMessage,
  buildOverlyBroadVisionGrepMessage,
  buildSearchFilesContentQueryMessage,
  type ToolGuardContext,
} from "./agentExploreGuard";
import { isRuntimeVisibleTextGrepPattern } from "./visionAnchorPrefgrep";
import { WRITE_AGENT_TOOL_NAMES } from "./agentToolDefinitions";

export type WriteStage = {
  files: Map<string, string>;
  deletions: Set<string>;
  writtenList: string[];
  readPaths: Set<string>;
};

export function createWriteStage(): WriteStage {
  return { files: new Map(), deletions: new Set(), writtenList: [], readPaths: new Set() };
}

export function trackWrittenFile(stage: WriteStage, relative: string) {
  if (!stage.writtenList.includes(relative)) {
    stage.writtenList.push(relative);
  }
}

export async function readStagedFileContent(
  readable: { path: string; key: string; outsideProject: boolean },
  stage: WriteStage | null,
): Promise<string | null> {
  if (!readable.outsideProject && stage?.files?.has(readable.key)) {
    return stage.files.get(readable.key)!;
  }
  const result = await readFileContent(readable.path).catch(() => null);
  return result?.ok ? result.content : null;
}

export async function isAgentsGuideOnlyPath(projectRoot: string, displayPath: string): Promise<boolean> {
  const base = path.basename(displayPath).replace(/\.(vue|tsx?|jsx?)$/i, "");
  if (!base || base.length < 3) return false;
  const result = await grepInProject(projectRoot, base, 24);
  if (!result.ok || !result.matches.length) return false;
  return result.matches.every(
    (m) => /AGENTS\.md$/i.test(m.relative) || /\.test\.(ts|tsx)$/i.test(m.relative),
  );
}

export function recordGrepHitVueFiles(
  toolGuard: ToolGuardContext | undefined,
  matches: Array<{ relative: string }>,
): void {
  if (!toolGuard?.visionLocateActive) return;
  const vueFiles = matches.filter((m) => m.relative.endsWith(".vue")).map((m) => m.relative);
  if (!vueFiles.length) return;
  if (!toolGuard.grepHitVueFiles) toolGuard.grepHitVueFiles = new Set();
  for (const file of vueFiles) toolGuard.grepHitVueFiles.add(file);
}

const LARGE_FILE_LINE_THRESHOLD = 500;

export function requirePriorRead(stage: WriteStage, relative: string, existsOnDisk: boolean): string | null {
  if (!existsOnDisk) return null;
  if (stage.readPaths.has(relative)) return null;
  return `错误：请先 read_file 核对 ${relative} 的真实内容，再修改该文件`;
}

function planDocumentBuildModeBlock(
  mode: VibeChatMode,
  relativePath: string,
  toolName: string,
): string | null {
  if (mode !== "build") return null;
  if (!isPlanDocumentPath(relativePath)) return null;
  return buildPlanDocumentBuildModeBlockedMessage(toolName);
}

export async function executeTool(
  projectRoot: string,
  name: string,
  args: Record<string, unknown>,
  stage: WriteStage | null,
  mode: VibeChatMode = "build",
  readCache?: Map<string, string>,
  readSliceCache?: Map<string, string>,
  grepCache?: Map<string, string>,
  readSliceRepeatCounts?: Map<string, number>,
  toolGuard?: ToolGuardContext,
  webProxyUrl?: string,
  injectedKeyFilePaths?: Set<string>,
): Promise<string> {
  if (mode === "ask" && WRITE_AGENT_TOOL_NAMES.has(name)) {
    return buildWriteToolBlockedMessage("ask");
  }
  if (mode === "explore" && (WRITE_AGENT_TOOL_NAMES.has(name) || name === "append_memory" || name === "write_skill")) {
    return buildWriteToolBlockedMessage("ask").replace("Ask 模式", "Explore 模式");
  }
  if (mode === "plan" && !stage && WRITE_AGENT_TOOL_NAMES.has(name)) {
    return buildWriteToolBlockedMessage("plan");
  }
  if (!stage && WRITE_AGENT_TOOL_NAMES.has(name)) {
    return buildWriteToolBlockedMessage("consultative_build");
  }
  const root = path.resolve(projectRoot);

  if (name === "list_dir") {
    const rel = String(args.path ?? "").trim();
    if (!rel) {
      const stat = await fs.promises.stat(root).catch(() => null);
      if (!stat?.isDirectory()) return "错误：不是目录 .";
      const items = await listDirectory(root);
      const lines = items.map((item) => `${item.isDirectory ? "[dir]" : "[file]"} ${item.name}`);
      return lines.length ? lines.join("\n") : "（空目录）";
    }
    const resolved = resolveReadablePath(root, rel);
    if (!resolved.ok) return `错误：${resolved.error}`;
    const stat = await fs.promises.stat(resolved.path).catch(() => null);
    if (!stat?.isDirectory()) return `错误：不是目录 ${resolved.displayPath}`;
    const items = await listDirectory(resolved.path);
    const lines = items.map((item) => {
      if (resolved.outsideProject) {
        const full = path.join(resolved.path, item.name).replace(/\\/g, "/");
        return `${item.isDirectory ? "[dir]" : "[file]"} ${full}`;
      }
      const itemRel = resolved.key ? `${resolved.key}/${item.name}` : item.name;
      return `${item.isDirectory ? "[dir]" : "[file]"} ${itemRel}`;
    });
    return lines.length ? lines.join("\n") : "（空目录）";
  }

  if (name === "read_file") {
    const filePath = String(args.path || "").trim();
    if (!filePath) return "错误：缺少 path";
    const resolved = resolveReadablePath(root, filePath);
    if (!resolved.ok) return `错误：${resolved.error}`;
    const planBlock = !resolved.outsideProject
      ? planDocumentBuildModeBlock(mode, resolved.key, "read_file")
      : null;
    if (planBlock) return planBlock;
    const fileStat = await fs.promises.stat(resolved.path).catch(() => null);
    if (!fileStat?.isFile()) {
      if (await isAgentsGuideOnlyPath(root, resolved.displayPath)) {
        return (
          `错误：${resolved.displayPath} 不存在或无法读取。` +
          "该路径可能仅为 AGENTS.md 术语别名；请 grep 读图可见文案或 kebab-case class 定位真实组件，勿重复 read 此路径。"
        );
      }
      return `错误：${resolved.displayPath} 不存在或无法读取`;
    }
    let content = readCache?.get(resolved.key) ?? null;
    if (content === null) {
      content = await readStagedFileContent(resolved, stage);
      if (content !== null) readCache?.set(resolved.key, content);
    }
    if (content === null) return `错误：${resolved.displayPath} 不存在或无法读取`;
    const offset = Number(args.offset) || 1;
    const defaultLimit = mode === "ask" || mode === "explore" ? 300 : mode === "plan" ? 400 : 350;
    const maxLimit = mode === "ask" || mode === "explore" ? 500 : mode === "plan" ? 600 : 500;
    const limit = Math.min(maxLimit, Math.max(1, Number(args.limit) || defaultLimit));
    const normalizedKey = resolved.key.replace(/\\/g, "/");
    if (
      injectedKeyFilePaths?.has(normalizedKey) &&
      offset <= 1 &&
      !args.offset &&
      !args.limit
    ) {
      return formatInjectedKeyFileReadNudge(resolved.displayPath);
    }
    const sliceKey = `${resolved.key}:${offset}:${limit}`;
    const lineRange = readLineRangeFromArgs(offset, limit);
    const patchRecoveryRead = consumePatchRecoveryRead(toolGuard, resolved.key);
    if (patchRecoveryRead) {
      invalidateFileReadState(
        resolved.key,
        readSliceCache,
        readSliceRepeatCounts,
        toolGuard?.readFileRanges,
      );
      readCache?.delete(resolved.key);
      content = await readStagedFileContent(resolved, stage);
      if (content !== null) readCache?.set(resolved.key, content);
      if (content === null) return `错误：${resolved.displayPath} 不存在或无法读取`;
    }
    if (toolGuard && !patchRecoveryRead) {
      const overlapErr = checkOverlappingRead(resolved.key, lineRange, toolGuard.readFileRanges);
      if (overlapErr) return overlapErr;
    }
    const cachedSlice = !patchRecoveryRead ? readSliceCache?.get(sliceKey) : undefined;
    if (cachedSlice) {
      const repeats = (readSliceRepeatCounts?.get(sliceKey) ?? 0) + 1;
      readSliceRepeatCounts?.set(sliceKey, repeats);
      if (repeats > MAX_READ_SLICE_REPEATS) {
        return `错误：已连续 ${repeats} 次读取相同片段 ${resolved.displayPath}（offset ${offset} limit ${limit}），请基于已有内容继续分析或 patch_file，若需更多行请一次读更大范围（300-500 行），勿重复读相同片段。`;
      }
      return `${cachedSlice}\n（与上次 read_file 相同，已省略重复读取）`;
    }
    const sliced = sliceFileLines(content, offset, limit);
    readSliceCache?.set(sliceKey, sliced);
    if (toolGuard) {
      recordReadRange(resolved.key, lineRange, toolGuard.readFileRanges);
    }
    if (!resolved.outsideProject) {
      stage?.readPaths?.add(resolved.key);
    }
    return sliced;
  }

  if (name === "grep") {
    const pattern = String(args.pattern || "").trim();
    if (!pattern) return "错误：缺少 pattern";
    if (toolGuard?.visionMisreadActive && isBlockedGrepAfterVisionMisread(pattern, true)) {
      return buildBlockedGrepMessage(pattern);
    }
    if (
      toolGuard?.visionLocateActive &&
      toolGuard.visionAnchorQuotes?.length &&
      isOverlyBroadVisionGrep(pattern, toolGuard.visionAnchorQuotes, [
        ...(toolGuard.visionNarrativeText ? [toolGuard.visionNarrativeText] : []),
      ])
    ) {
      const probe = await grepInProject(root, pattern, 10);
      if (!(probe.ok && isVisionGrepLowSpread(probe.matches))) {
        return buildOverlyBroadVisionGrepMessage(pattern, toolGuard.visionAnchorQuotes);
      }
    }
    if (toolGuard?.visionLocateActive && isLowSignalVisionLocateGrep(pattern)) {
      return buildLowSignalVisionLocateGrepMessage(pattern);
    }
    if (toolGuard?.visionLocateActive && isRuntimeVisibleTextGrepPattern(pattern)) {
      return buildLowSignalVisionLocateGrepMessage(pattern);
    }
    if (
      toolGuard &&
      isBlockedGrepAfterLocate(pattern, toolGuard.patchAnchorLocated, toolGuard.teleportBodyConfirmed)
    ) {
      return buildBlockedGrepAfterLocateMessage(pattern);
    }
    const maxMatches = Math.min(80, Math.max(1, Number(args.max_matches) || 40));
    const grepKey = `${pattern}:${maxMatches}`;
    const cached = grepCache?.get(grepKey);
    if (cached) {
      return `${cached}\n（与上次 grep 相同，已省略重复搜索）`;
    }
    const result = await grepInProject(root, pattern, maxMatches);
    if (!result.ok) return `错误：${result.error}`;
    if (toolGuard) {
      if (!toolGuard.grepPatterns) toolGuard.grepPatterns = [];
      if (!toolGuard.grepPatterns.includes(pattern)) toolGuard.grepPatterns.push(pattern);
    }
    if (!result.matches.length) {
      const empty = "（无匹配）";
      grepCache?.set(grepKey, empty);
      return empty;
    }
    const output = result.matches
      .map((m) => `${m.relative}:${m.line}: ${m.text}`)
      .join("\n");
    grepCache?.set(grepKey, output);
    recordGrepHitVueFiles(toolGuard, result.matches);
    return output;
  }

  if (name === "search_files") {
    const query = String(args.query || "").trim();
    if (!query) return "错误：缺少 query";
    if (toolGuard?.visionLocateActive && isSearchFilesContentQuery(query)) {
      return buildSearchFilesContentQueryMessage(query);
    }
    const maxResults = Math.min(50, Math.max(1, Number(args.max_results) || 30));
    const results = await searchFiles(root, query, maxResults);
    if (!results.length) return buildSearchFilesEmptyHint(query);
    return results.map((r) => `${r.isDirectory ? "[dir]" : "[file]"} ${r.relative}`).join("\n");
  }

  if (name === "write_file") {
    if (!stage) return buildWriteToolBlockedMessage("consultative_build");
    const filePath = String(args.path || "").trim();
    const content = args.content;
    if (!filePath) return "错误：缺少 path";
    if (typeof content !== "string") return "错误：缺少 content";
    const resolved = resolveProjectPath(root, filePath);
    if (!resolved.ok) return `错误：${resolved.error}`;
    const planWriteBlock = planDocumentBuildModeBlock(mode, resolved.relative, "write_file");
    if (planWriteBlock) return planWriteBlock;
    if (toolGuard?.blockExplorationArchiveWrite && isExplorationArchivePath(resolved.relative)) {
      return buildExplorationArchiveWriteBlockedMessage();
    }
    const stat = await fs.promises.stat(resolved.path).catch(() => null);
    const existsOnDisk = !!stat?.isFile();
    const readErr = requirePriorRead(stage, resolved.relative, existsOnDisk);
    if (readErr) return readErr;
    if (existsOnDisk) {
      const existing =
        stage.files.get(resolved.relative) ??
        readCache?.get(resolved.relative) ??
        (await readFileContent(resolved.path).catch(() => null))?.content ??
        "";
      const existingLines = existing ? existing.split(/\r?\n/).length : 0;
      const newLines = content.split(/\r?\n/).length;
      if (existingLines >= LARGE_FILE_LINE_THRESHOLD || newLines >= LARGE_FILE_LINE_THRESHOLD) {
        return `错误：${resolved.relative} 为大文件（${existingLines || newLines} 行），请用 patch_file 局部修改`;
      }
    }
    stage.deletions.delete(resolved.relative);
    stage.files.set(resolved.relative, content);
    readCache?.set(resolved.relative, content);
    try {
      await writeFileContent(resolved.path, content);
    } catch (error) {
      return `错误：写入 ${resolved.relative} 失败：${error instanceof Error ? error.message : String(error)}`;
    }
    trackWrittenFile(stage, resolved.relative);
    invalidateProjectContextCache(root);
    invalidateFileReadState(
      resolved.relative,
      readSliceCache,
      readSliceRepeatCounts,
      toolGuard?.readFileRanges,
    );
    return `已写入 ${resolved.relative}（${content.length} 字符）`;
  }

  if (name === "patch_file") {
    if (!stage) return buildWriteToolBlockedMessage("consultative_build");
    const filePath = String(args.path || "").trim();
    const oldString = args.old_string;
    const newString = args.new_string;
    if (!filePath) return "错误：缺少 path";
    if (typeof oldString !== "string" || !oldString) return "错误：缺少 old_string";
    if (typeof newString !== "string") return "错误：缺少 new_string";
    const resolved = resolveProjectPath(root, filePath);
    if (!resolved.ok) return `错误：${resolved.error}`;
    const planPatchBlock = planDocumentBuildModeBlock(mode, resolved.relative, "patch_file");
    if (planPatchBlock) return planPatchBlock;
    const stat = await fs.promises.stat(resolved.path).catch(() => null);
    const readErr = requirePriorRead(stage, resolved.relative, !!stat?.isFile());
    if (readErr) return readErr;
    let content = stage.files.get(resolved.relative) ?? readCache?.get(resolved.relative) ?? null;
    if (content === null) {
      content = await readStagedFileContent(
        { path: resolved.path, key: resolved.relative, outsideProject: false },
        stage,
      );
      if (content !== null) readCache?.set(resolved.relative, content);
    }
    if (content === null) return `错误：${resolved.relative} 不存在或无法读取`;
    const readCheck = checkPatchOldStringFromReads(
      resolved.relative,
      oldString,
      readSliceCache ?? new Map(),
      readCache,
    );
    if (readCheck) {
      markPatchRecoveryFile(toolGuard, resolved.relative);
      invalidateFileReadState(
        resolved.relative,
        readSliceCache,
        readSliceRepeatCounts,
        toolGuard?.readFileRanges,
      );
      return readCheck;
    }
    if (
      isIntrospectBusinessRoutePatch(resolved.relative, oldString, newString)
    ) {
      return buildIntrospectProbeBlockedMessage();
    }
    const patchResult = applyUniquePatch(content, oldString, newString);
    if (!patchResult.ok) {
      markPatchRecoveryFile(toolGuard, resolved.relative);
      invalidateFileReadState(
        resolved.relative,
        readSliceCache,
        readSliceRepeatCounts,
        toolGuard?.readFileRanges,
      );
      return patchResult.error;
    }
    const patched = patchResult.patched;
    stage.deletions.delete(resolved.relative);
    stage.files.set(resolved.relative, patched);
    readCache?.set(resolved.relative, patched);
    try {
      await writeFileContent(resolved.path, patched);
    } catch (error) {
      return `错误：写入 ${resolved.relative} 失败：${error instanceof Error ? error.message : String(error)}`;
    }
    trackWrittenFile(stage, resolved.relative);
    invalidateProjectContextCache(root);
    invalidateFileReadState(
      resolved.relative,
      readSliceCache,
      readSliceRepeatCounts,
      toolGuard?.readFileRanges,
    );
    if (toolGuard) toolGuard.visionLocateActive = false;
    return `已修改 ${resolved.relative}（${oldString.length} → ${newString.length} 字符）`;
  }

  if (name === "delete_file") {
    if (!stage) {
      return buildWriteToolBlockedMessage("consultative_build").replace("写文件", "删除文件");
    }
    const filePath = String(args.path || "").trim();
    if (!filePath) return "错误：缺少 path";
    const resolved = resolveProjectPath(root, filePath);
    if (!resolved.ok) return `错误：${resolved.error}`;
    const planDeleteBlock = planDocumentBuildModeBlock(mode, resolved.relative, "delete_file");
    if (planDeleteBlock) return planDeleteBlock;
    const stat = await fs.promises.stat(resolved.path).catch(() => null);
    if (!stat?.isFile()) return `错误：${resolved.relative} 不是文件或不存在`;
    stage.files.delete(resolved.relative);
    stage.deletions.add(resolved.relative);
    readCache?.delete(resolved.relative);
    try {
      await fs.promises.unlink(resolved.path);
    } catch (error) {
      return `错误：删除 ${resolved.relative} 失败：${error instanceof Error ? error.message : String(error)}`;
    }
    trackWrittenFile(stage, resolved.relative);
    invalidateProjectContextCache(root);
    return `已删除 ${resolved.relative}`;
  }

  if (name === "append_memory") {
    if (mode === "ask") return "Ask 模式下不支持写入项目记忆。";
    if (mode === "explore") return "Explore 模式下不支持写入项目记忆。";
    if (mode === "plan" && !stage) return buildWriteToolBlockedMessage("plan");
    const section = String(args.section ?? "").trim();
    const content = String(args.content ?? "").trim().replace(/\s+/g, " ");
    if (!isProjectMemorySection(section)) {
      return "错误：section 须为 术语、导航 或 偏好";
    }
    if (!content) return "错误：缺少 content";
    if (content.length > 200) return "错误：content 过长（最多 200 字）";
    const result = await appendProjectMemory(root, section, [content]);
    if (!result.ok) return `写入失败：${result.error}`;
    invalidateProjectContextCache(root);
    return `已写入项目记忆（## ${section}）：${content}`;
  }

  if (name === "list_skills") {
    const result = await listProjectSkills(root);
    if (!result.ok) return `错误：${result.error}`;
    if (!result.skills.length) return "（无 skill 文件）";
    return result.skills.map((s) => `- ${s.slug} [${s.kind}] ${s.title}`).join("\n");
  }

  if (name === "read_skill") {
    const slug = String(args.slug ?? "").trim();
    if (!slug) return "错误：缺少 slug";
    const result = await readProjectSkill(root, slug);
    if (!result.ok) return `错误：${result.error}`;
    return `# ${result.frontmatter.title} (${result.slug})\nkind: ${result.frontmatter.kind}\n\n${result.body}`;
  }

  if (name === "propose_skill") {
    if (mode === "ask") return "Ask 模式下不支持写入 skill。";
    if (mode === "explore") return "Explore 模式下不支持写入 skill。";
    if (mode === "plan" && !stage) return buildWriteToolBlockedMessage("plan");
    const slug = String(args.slug ?? "").trim();
    const kind = String(args.kind ?? "").trim();
    const title = String(args.title ?? "").trim();
    const content = String(args.content ?? "").trim();
    if (!slug || !title || !content) return "错误：缺少 slug / title / content";
    if (kind !== "fact" && kind !== "heuristic" && kind !== "preference") {
      return "错误：kind 须为 fact、heuristic 或 preference";
    }
    if (content.length > 2000) return "错误：content 过长（最多 2000 字）";
    return buildSkillProposalToolResult({ slug, kind, title, content });
  }

  if (name === "run_command") {
    if (mode === "ask") return "Ask 模式下不支持执行命令。";
    if (mode === "explore") return "Explore 模式下不支持执行命令。";
    if (mode === "plan") return "Plan 模式下不支持执行命令。";
    const command = String(args.command || "").trim();
    if (!command) return "错误：缺少 command";
    const dangerous = /rm\s+-rf\s+[\/~]|format\s+[a-z]:|del\s+\/[sfq]/i;
    if (dangerous.test(command)) return "错误：禁止执行危险命令";

    const timeoutMs = Math.min(120000, Math.max(5000, Number(args.timeout_ms) || 30000));
    const execFileAsync = promisify(execFile);
    const shell = process.platform === "win32" ? "powershell.exe" : "/bin/sh";
    const shellFlag = process.platform === "win32" ? "-Command" : "-c";
    try {
      const { stdout, stderr } = await execFileAsync(shell, [shellFlag, command], {
        cwd: root,
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      });
      const out = String(stdout || "").trim();
      const err = String(stderr || "").trim();
      if (!out && !err) return "（命令执行完成，无输出）";
      const parts: string[] = [];
      if (out) parts.push(`stdout:\n${out}`);
      if (err) parts.push(`stderr:\n${err}`);
      return parts.join("\n\n");
    } catch (error: any) {
      if (error.killed) return `错误：命令超时（${timeoutMs}ms）`;
      const out = String(error.stdout || "").trim();
      const err = String(error.stderr || "").trim();
      const parts: string[] = [];
      if (out) parts.push(`stdout:\n${out}`);
      if (err) parts.push(`stderr:\n${err}`);
      if (error.status !== undefined) parts.push(`exit code: ${error.status}`);
      return parts.length ? `命令执行失败：\n${parts.join("\n\n")}` : `错误：${error.message}`;
    }
  }

  if (name === "git_status") {
    return runGitStatusTool(root);
  }

  if (name === "git_diff") {
    const filePath = String(args.path || "").trim() || undefined;
    const staged = args.staged === true;
    return runGitDiffTool(root, filePath, staged);
  }

  if (name === "web_search") {
    const query = String(args.query || "").trim();
    if (!query) return "错误：缺少 query";
    const engine = String(args.engine || "baidu").trim();
    const maxResults = Math.min(10, Math.max(1, Number(args.max_results) || 5));
    const result = await runWebSearch(query, engine, maxResults, webProxyUrl);
    if (!result.ok) return `错误：${result.error}`;
    return result.text || "（无结果）";
  }

  if (name === "web_extract") {
    const url = String(args.url || "").trim();
    if (!url) return "错误：缺少 url";
    if (!/^https?:\/\//.test(url)) return "错误：url 必须以 http:// 或 https:// 开头";
    const extractMode = String(args.mode || "auto").trim();
    const outcome = await runWebExtract({ url, mode: extractMode, proxyUrl: webProxyUrl }, () => {});
    const payload = outcome.payload as Record<string, unknown>;
    if (!payload.ok) {
      return `错误：${payload.error || "抓取失败"}`;
    }
    const title = String(payload.title || "无标题");
    const text = String(payload.text || "").slice(0, 120000);
    return `网页抓取成功\n标题：${title}\n正文：\n${text}`;
  }

  return `错误：未知工具 ${name}`;
}
