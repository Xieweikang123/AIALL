import fs from "node:fs";
import path from "node:path";

export type TextParsingCategory =
  | "behavior"
  | "guard"
  | "render"
  | "classifier"
  | "deterministic";

export type TextParsingSite = {
  relPath: string;
  category: TextParsingCategory;
  reason: string;
};

/**
 * 模型/助手/工具自由文本 → 程序行为的解析契约清单。
 *
 * 铁律：模型自由文本只能用于「渲染」；凡驱动行为/交互（按钮、提案、分组、
 * 状态）必须走结构化契约（SSE 事件 / 固定标记 + JSON 校验），禁止宽松正则
 * 嗅探。新增此类解析必须在此登记并写明合规方式，否则
 * agentTextParsingContract.test.ts 会失败。
 *
 * 类别说明：
 * - behavior:    驱动 UI/流程，应迁结构化契约（或已用标记+校验的合规形式）
 * - guard:       准确度守卫，解析助手自身输出，误判无害（fail-safe）
 * - render:      markdown 分段/渲染，fence-aware 处理
 * - classifier:  用户输入意图分类，结构特征 + 测试约束
 * - deterministic: 确定性格式（git/测试/源码），正则合理
 */
export const MODEL_TEXT_PARSING_SITES: TextParsingSite[] = [
  // ---- 行为驱动（应走结构化契约；标记契约/JSON 提取为合规形式）----
  {
    relPath: "src/utils/parseAiOptions.ts",
    category: "behavior",
    reason: "待迁移：回复编号选项 → 按钮，应改为 choices SSE 事件（当前宽松嗅探）",
  },
  {
    relPath: "src/utils/parseClarificationChoices.ts",
    category: "behavior",
    reason: "待迁移：回复澄清选项 → 按钮，应改为 choices SSE 事件（当前宽松嗅探）",
  },
  {
    relPath: "src/services/agentSuggestedOptions.ts",
    category: "behavior",
    reason: "选项提取：模型被指令输出固定 schema（isChoice/options），围栏 + 首尾裁剪 + 严格 parse + 数量/去重校验",
  },
  {
    relPath: "src/utils/chatCompletionText.ts",
    category: "behavior",
    reason: "模型 JSON 契约提取：围栏 + 首尾对象裁剪 + 严格 parse（模型被指令输出 JSON）",
  },
  {
    relPath: "src/services/projectMemoryProposal.ts",
    category: "behavior",
    reason: "标记契约（推荐模式）：固定前缀【memory_proposal】+ JSON 校验 + 失败降级",
  },
  {
    relPath: "src/services/projectSkillProposal.ts",
    category: "behavior",
    reason: "标记契约（推荐模式）：固定前缀 + JSON 校验 + 失败降级",
  },
  {
    relPath: "src/composables/useAgentToolDispatch.ts",
    category: "behavior",
    reason: "提案分发入口；实际解析在 projectMemoryProposal / projectSkillProposal（已登记）",
  },
  {
    relPath: "src/composables/useGitBatchCommit.ts",
    category: "behavior",
    reason: "模型批量提交分组：流式部分 JSON 解析，应统一为结构化事件",
  },
  {
    relPath: "src/services/agentIntentClassifier.ts",
    category: "behavior",
    reason: "AI 意图分类器响应解析（模型被指令输出固定 schema）",
  },
  {
    relPath: "src/services/agentIntentClassifierClient.ts",
    category: "behavior",
    reason: "分类器响应 JSON 提取（同 agentIntentClassifier）",
  },
  {
    relPath: "src-tauri/src/commands/git.rs",
    category: "behavior",
    reason: "AI 批量提交分组 JSON 解析（模型输出），应统一为结构化事件",
  },

  // ---- 准确度守卫（解析助手自身输出，误判无害）----
  {
    relPath: "src/orchestration/product/visionMessage.ts",
    category: "guard",
    reason: "读图守卫：提取可见锚点文案，误判只多提示",
  },
  {
    relPath: "src-tauri/src/agent/vision.rs",
    category: "guard",
    reason: "读图守卫：可见锚点引用提取",
  },
  {
    relPath: "src-tauri/src/agent/vision_consultative.rs",
    category: "guard",
    reason: "读图咨询守卫",
  },
  {
    relPath: "src-tauri/src/agent/vision_pregrep.rs",
    category: "guard",
    reason: "读图 pregrep 守卫",
  },
  {
    relPath: "src-tauri/src/agent/consultative_trace.rs",
    category: "guard",
    reason: "咨询 trace 守卫：解析助手输出检测推测断言",
  },
  {
    relPath: "src-tauri/src/agent/exploration.rs",
    category: "guard",
    reason: "探索预算 / 推测断言守卫",
  },
  {
    relPath: "src-tauri/src/agent/explore_guard.rs",
    category: "guard",
    reason: "探索守卫",
  },
  {
    relPath: "src-tauri/src/agent/probe_guard.rs",
    category: "guard",
    reason: "probe 守卫",
  },

  // ---- 渲染层（markdown 分段/渲染）----
  {
    relPath: "src/components/ChatMarkdown.vue",
    category: "render",
    reason: "markdown 渲染 + 复用已登记解析器渲染选项按钮",
  },
  {
    relPath: "src/services/agentNarrativeSegments.ts",
    category: "render",
    reason: "fence-aware markdown 分段",
  },
  {
    relPath: "src/services/agentRoundGroups.ts",
    category: "render",
    reason: "轮次分段",
  },
  {
    relPath: "src/services/agentCursorFeed.ts",
    category: "render",
    reason: "feed 分段",
  },

  // ---- 用户输入意图分类（结构特征 + 测试约束，设计如此）----
  {
    relPath: "src/orchestration/generic/userIntentClassifiers.ts",
    category: "classifier",
    reason: "用户意图分类：只认消息结构，禁业务词",
  },
  {
    relPath: "src/orchestration/generic/actionClassifier.ts",
    category: "classifier",
    reason: "动作分类：结构特征",
  },
  {
    relPath: "src/orchestration/generic/ambiguousTermTriggers.ts",
    category: "classifier",
    reason: "歧义术语提取：结构特征",
  },
  {
    relPath: "src/orchestration/generic/quotedAmendIntent.ts",
    category: "classifier",
    reason: "引用修订意图：解析任务提示词中 操作：/目标符号： 标记（标记契约）",
  },
  {
    relPath: "src/orchestration/product/agentTopicFollowUp.ts",
    category: "classifier",
    reason: "短追问意图分类：结构特征",
  },
  {
    relPath: "src/services/agentContinuation.ts",
    category: "classifier",
    reason: "续跑意图分类 + plan 标记检测",
  },
  {
    relPath: "src/services/intentClassifierAi.ts",
    category: "classifier",
    reason: "AI 分类器 prompt / 响应 parse",
  },
  {
    relPath: "src-tauri/src/agent/continuation.rs",
    category: "classifier",
    reason: "续跑意图分类：结构特征",
  },
  {
    relPath: "src-tauri/src/agent/ambiguous_term.rs",
    category: "classifier",
    reason: "歧义术语提取：结构特征",
  },
  {
    relPath: "src-tauri/src/agent/consultative_topics.rs",
    category: "classifier",
    reason: "咨询主题识别：结构特征",
  },
  {
    relPath: "src-tauri/src/agent/quoted_amend.rs",
    category: "classifier",
    reason: "引用修订意图：标记契约",
  },
  {
    relPath: "src-tauri/src/agent/finish_gate.rs",
    category: "classifier",
    reason: "任务契约标记解析（锚点 / 排除 / 极性）",
  },

  // ---- 确定性格式（API/协议契约，正则合理）----
  {
    relPath: "src-tauri/src/agent/run_stream.rs",
    category: "deterministic",
    reason: "LLM API SSE 协议流解析（tool_calls JSON 段）",
  },
];

/** TS 侧「解析模型/助手文本」的函数名嗅探（声明处，不含调用）。 */
const TS_SMELL =
  /\b(?:export\s+)?(?:function|const)\s+((?:parse|extract|split)\w*(?:Model|Assistant|AiOption|Options|Clarification|Choices|Proposal|ToolResult|IntentClassifier|FromModel|PartialGroups|BatchGroup|Narrative|Response|Quotes)(?:[A-Z]\w*)?)/g;

/** Rust 侧（src-tauri）同上，snake_case 定义处；词元需为下划线分隔的完整段。 */
const RS_SMELL =
  /\bfn\s+((?:parse|extract|split|detect)_\w*_(?:ai|assistant|tool|proposal|batch|model|quote|anchor)\w*)/g;

export function findModelTextParsingSymbols(source: string, lang: "ts" | "rs"): string[] {
  const re = lang === "ts" ? TS_SMELL : RS_SMELL;
  const hits = new Set<string>();
  for (const match of source.matchAll(re)) hits.add(match[1]);
  return [...hits];
}

/** 扫描全部实现文件，返回「嗅探命中但未登记在契约清单」的站点。 */
export function scanUnregisteredModelTextParsing(repoRoot: string): Map<string, string[]> {
  const allowed = new Set(MODEL_TEXT_PARSING_SITES.map((site) => site.relPath.replace(/\\/g, "/")));
  const results = new Map<string, string[]>();

  function scanDir(absDir: string, relDir: string, lang: "ts" | "rs") {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      const abs = path.join(absDir, entry.name);
      const rel = path.join(relDir, entry.name).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        scanDir(abs, rel, lang);
        continue;
      }
      const isSource =
        lang === "ts"
          ? /\.(ts|vue)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)
          : entry.name.endsWith(".rs");
      if (!isSource) continue;
      const symbols = findModelTextParsingSymbols(fs.readFileSync(abs, "utf8"), lang);
      if (!symbols.length) continue;
      if (allowed.has(rel)) continue;
      results.set(rel, symbols);
    }
  }

  scanDir(path.join(repoRoot, "src"), "src", "ts");
  scanDir(path.join(repoRoot, "src-tauri", "src"), "src-tauri/src", "rs");
  return results;
}
