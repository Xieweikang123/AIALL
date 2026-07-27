/**
 * Tier 1 — ambiguous / proper-noun triggers for sparse project context.
 * Shape-based extraction only; no business-specific terms in patterns.
 */
import {
  extractPlanFilePaths,
  isPlanQuotePrompt,
  stripQuotedReplyPrefix,
} from "../../services/agentContinuation";
import type { UserIntentHistoryMessage } from "../agentIntentTypes";

export type ProjectContextSnapshot =
  | {
      ok: true;
      tree?: string;
      keyFiles?: Array<{ path: string; content: string }>;
      stackProfile?: {
        languages?: string[];
        frameworks?: string[];
        capabilities?: string[];
        manifestFiles?: string[];
        entryHints?: string[];
      };
    }
  | { ok: false }
  | null
  | undefined;

/** Visible context lacks manifest facts or source structure to ground domain terms. */
export function isSparseProjectContext(context: ProjectContextSnapshot): boolean {
  if (!context?.ok) return true;
  if (context.stackProfile?.manifestFiles?.length) return false;
  const treeLines = (context.tree ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (treeLines.length === 0) return true;
  const keyFiles = context.keyFiles ?? [];
  if (keyFiles.length === 0 && treeLines.length <= 3) return true;
  return false;
}

const GENERIC_DOMAIN_STOPWORDS = new Set([
  "用户",
  "前端",
  "后端",
  "系统",
  "项目",
  "应用",
  "服务",
  "数据",
  "接口",
  "页面",
  "模块",
  "功能",
  "平台",
  "客户端",
  "服务器",
  "浏览器",
  "移动端",
  "桌面端",
  "程序",
  "软件",
  "网站",
  "网页",
  "代码",
  "文件",
  "目录",
  "配置",
  "环境",
  "版本",
  "测试",
  "部署",
  "开发",
  "设计",
  "需求",
  "方案",
  "示例",
  "默认",
  "独立",
  "新建",
  "现有",
  "当前",
  "相关",
  "业务",
  "逻辑",
  "流程",
  "工具",
  "框架",
  "组件",
  "控制器",
  "模型",
  "健康",
  "检查",
]);

/** Common stack tokens — not treated as ambiguous proper nouns. */
const KNOWN_TECH_TERMS = new Set([
  "net",
  "dotnet",
  "webapi",
  "api",
  "aspnet",
  "aspnetcore",
  "csharp",
  "swagger",
  "openapi",
  "cors",
  "kestrel",
  "iis",
  "docker",
  "kubernetes",
  "vue",
  "react",
  "angular",
  "node",
  "npm",
  "pnpm",
  "yarn",
  "typescript",
  "javascript",
  "python",
  "java",
  "spring",
  "gradle",
  "maven",
  "rust",
  "cargo",
  "go",
  "grpc",
  "rest",
  "graphql",
  "sql",
  "mysql",
  "postgres",
  "redis",
  "mongodb",
  "json",
  "xml",
  "http",
  "https",
  "wasm",
  "webgl",
  "threejs",
  "cesium",
  "entityframework",
  "efcore",
  "nuget",
  "sln",
  "csproj",
  "program",
  "controller",
  "middleware",
]);

const RECIPIENT_PHRASE_RE =
  /(?:给|供|为|对接|服务于)\s*([^，。；！？\n「」『』""''（）()【】\[\]：:]{2,10}?)\s*(?:调用|使用|对接|提供|服务|开发|写|做|起|搭建)/g;

const QUOTED_TERM_RE = /[「『"']([^」』"']{2,16})[」』"']/g;

const USER_DISAMBIGUATION_RE =
  /(?:指的是|是指|也就是|即指|亦即|具体是|其实是|实为|我(?:这里)?说的)/;

const CLARIFICATION_OFFER_RE =
  /(?:澄清|请确认|能否说明|可否说明|帮忙确认|是指|指的是|哪种|哪类|是否指)/;

function normalizeTerm(term: string): string {
  return term.trim().replace(/\s+/g, "").toLowerCase();
}

function isKnownTechTerm(term: string): boolean {
  const normalized = normalizeTerm(term);
  if (!normalized) return true;
  if (KNOWN_TECH_TERMS.has(normalized)) return true;
  if (/^\.?net\d*$/i.test(normalized)) return true;
  if (/^(?:web\s*)?api$/i.test(normalized)) return true;
  if (/^[a-z0-9._-]+$/i.test(normalized) && normalized.length <= 12) {
    return KNOWN_TECH_TERMS.has(normalized.replace(/[^a-z0-9]/gi, ""));
  }
  return false;
}

function isGenericStopword(term: string): boolean {
  const trimmed = term.trim();
  if (!trimmed) return true;
  if (GENERIC_DOMAIN_STOPWORDS.has(trimmed)) return true;
  if (/^(?:一个|一套|一份|一些|这个|那个|相关|基础|简单|完整|独立)/.test(trimmed)) return true;
  return false;
}

function isGroundedInProject(term: string, contextText: string): boolean {
  const normalized = normalizeTerm(term);
  if (!normalized || !contextText.trim()) return false;
  return contextText.toLowerCase().includes(normalized);
}

function collectProjectContextText(context: ProjectContextSnapshot): string {
  if (!context?.ok) return "";
  const profile = context.stackProfile;
  const profileParts = profile
    ? [
        ...(profile.languages ?? []),
        ...(profile.frameworks ?? []),
        ...(profile.capabilities ?? []),
        ...(profile.manifestFiles ?? []),
        ...(profile.entryHints ?? []),
      ]
    : [];
  const parts = [
    context.tree ?? "",
    ...profileParts,
    ...(context.keyFiles ?? []).map((f) => `${f.path}\n${f.content}`),
  ];
  return parts.join("\n");
}

function extractCandidateTerms(prompt: string): string[] {
  const text = stripQuotedReplyPrefix(prompt.trim());
  const found = new Set<string>();

  for (const re of [RECIPIENT_PHRASE_RE, QUOTED_TERM_RE]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const raw = match[1]?.trim();
      if (raw) found.add(raw);
    }
  }

  return [...found];
}

export function extractUngroundedAmbiguousTerms(
  prompt: string,
  context: ProjectContextSnapshot,
): string[] {
  const contextText = collectProjectContextText(context);
  const terms: string[] = [];

  for (const raw of extractCandidateTerms(prompt)) {
    if (raw.length < 2 || raw.length > 12) continue;
    if (/^[\d\s._/-]+$/.test(raw)) continue;
    if (/\.(?:vue|ts|tsx|js|jsx|json|md|cs|csproj|sln)$/i.test(raw)) continue;
    if (isGenericStopword(raw)) continue;
    if (isKnownTechTerm(raw)) continue;
    if (isGroundedInProject(raw, contextText)) continue;
    terms.push(raw);
  }

  return [...new Set(terms)];
}

export function userPromptSelfDisambiguates(prompt: string): boolean {
  return USER_DISAMBIGUATION_RE.test(stripQuotedReplyPrefix(prompt.trim()));
}

export function hasRecentAmbiguityClarificationOffer(
  history: UserIntentHistoryMessage[] | undefined,
  terms: string[],
): boolean {
  if (!terms.length) return false;
  const recentAssistant = (history ?? [])
    .filter((m) => m.role === "assistant")
    .slice(-3);
  return recentAssistant.some((m) => {
    if (!CLARIFICATION_OFFER_RE.test(m.content)) return false;
    return terms.some((term) => m.content.includes(term));
  });
}

export interface ResolveAmbiguousClarificationInput {
  prompt: string;
  history?: UserIntentHistoryMessage[];
  projectContext: ProjectContextSnapshot;
  mode: "ask" | "build" | "plan" | "explore" | "auto";
  isExecutePlan: boolean;
  isPlanExplore: boolean;
  readOnlyBuildRun: boolean;
  implementFollowUpRun: boolean;
}

/** Terms that must enter clarification flow before planning/scaffolding. */
export function resolveAmbiguousClarificationTerms(
  input: ResolveAmbiguousClarificationInput,
): string[] {
  const body = stripQuotedReplyPrefix(input.prompt.trim());
  if (!body) return [];

  if (input.isExecutePlan) return [];
  if (input.mode === "ask" || input.mode === "explore") return [];
  if (input.readOnlyBuildRun) return [];
  if (isPlanQuotePrompt(body)) return [];
  if (extractPlanFilePaths(body).length > 0) return [];
  if (userPromptSelfDisambiguates(body)) return [];
  if (!isSparseProjectContext(input.projectContext)) return [];

  const terms = extractUngroundedAmbiguousTerms(body, input.projectContext);
  if (!terms.length) return [];
  if (hasRecentAmbiguityClarificationOffer(input.history, terms)) return [];

  return terms;
}

export function looksLikePrematurePlanOrScaffold(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/(?:^|\n)\s*(?:##\s*修改方案|\[PLAN\]|<!--\s*agent-plan\s*-->)/i.test(trimmed)) return true;
  if (/涉及文件清单|具体改动说明|改动顺序和依赖|确认无误后回复「执行方案」/.test(trimmed)) {
    return true;
  }
  const fencedBlocks = trimmed.match(/```[\s\S]*?```/g) ?? [];
  if (fencedBlocks.length >= 2) return true;
  if (fencedBlocks.length >= 1 && /(?:csproj|Program\.cs|Controller|appsettings)/i.test(trimmed)) {
    return true;
  }
  return false;
}

export function looksLikeClarificationQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || looksLikePrematurePlanOrScaffold(trimmed)) return false;
  const questionMarks = (trimmed.match(/[?？]/g) ?? []).length;
  if (questionMarks >= 1 && CLARIFICATION_OFFER_RE.test(trimmed)) return true;
  if (questionMarks >= 2) return true;
  return false;
}
