/**
 * 从「上下文超窗」报错里学到模型真实的上下文窗口，并写回本地模型配置。
 *
 * ## 为什么需要它
 *
 * 官方接口（DeepSeek / OpenAI 等）的 `/models` **不返回** `context_length`，
 * 所以配置页那个「获取」按钮对它们无效 —— 只能退回内置表猜，而内置表常常猜错代际
 * （一条裸 `deepseek` 前缀就把所有代次都按 6.4 万算）。
 *
 * 但真的把上下文撑爆时，provider 的报错里通常**直接写出自己的上限**。报错原文会
 * 一路透传到前端（Rust `ai/forward.rs` 把 response body 拼进错误信息 → SSE `error`
 * 事件），所以这是官方接口下唯一能拿到**真值**的途径。
 *
 * 解析交给纯函数 `parseContextWindowFromError`（可单测）；这里只管「写回哪、怎么落盘」。
 *
 * ## 写进哪个字段
 *
 * 写 `provider.modelWindows`（"provider 报告的值"），**不写** `modelWindowOverrides`
 * （那个语义是"用户手填"）。两者在解析优先级里的位次不同，混淆会让页面上分不清
 * "我填的"和"它说的"。既然 provider 确实亲口说了上限，记成 reported 是诚实的。
 */

import { getActiveProvider, loadPersistedAiConfigFromStorage, savePersistedAiConfigToStorage } from "./aiLocalConfig";
import { lookupReportedModelWindow, parseContextWindowFromError } from "./modelContextWindow";

export interface LearnedContextWindow {
  /** 学到的真实窗口（token） */
  tokens: number;
  /** 写进了哪个模型名（可能与传入的 model 不同 —— 见 resolveTargetModel） */
  model: string;
}

/**
 * 找到该把窗口记在哪个模型名下。
 *
 * 优先用调用方给的 `model`（通常是本次 run 实际用的 `assistantMsg.agentModel`，
 * 会话里换过模型时它和供应商配置里的默认 model 可能不同 —— 记错名字等于没记）。
 * 拿不到就退回当前供应商配置的 model。
 */
function resolveTargetModel(configModel: string, runModel: string): string {
  const run = runModel.trim();
  if (run) return run;
  return configModel.trim();
}

export function learnContextWindowFromError(params: {
  /** provider 报错原文（含 HTTP body） */
  errorText: string;
  /** 本次 run 实际用的模型名；空则用当前供应商配置的 */
  model?: string;
}): LearnedContextWindow | null {
  const { errorText, model } = params;
  const tokens = parseContextWindowFromError(errorText);
  if (!tokens) return null;

  const config = loadPersistedAiConfigFromStorage();
  if (!config) return null;
  // 只写当前激活的供应商：run 用的就是它那份配置。往别的供应商身上写属于串台，
  // 那个供应商的窗口会被改成另一个模型的数字。
  const provider = getActiveProvider(config);
  if (!provider) return null;

  const target = resolveTargetModel(provider.model ?? "", model ?? "");
  if (!target) return null;

  // 跟已知的（手填优先，其次 /models 抓的）不一致时不覆盖 —— 报错的措辞各provider
  // 差异大，误抓到一个别的数比保留原值更糟。真要改，用户在配置页手填即可（优先级最高）。
  const known = provider.modelWindowOverrides?.[target] ?? lookupReportedModelWindow(provider.modelWindows, target);
  if (known === tokens) return null;
  if (typeof known === "number" && known > 0) return null;

  provider.modelWindows = { ...(provider.modelWindows ?? {}), [target]: tokens };
  try {
    savePersistedAiConfigToStorage(config);
  } catch {
    // localStorage 不可用（隐私模式 / 配额满）：学到了但存不下，返回值让调用方
    // 仍然能提示用户「这个模型大概是多少」，下次超窗还会再学一遍。
  }
  return { tokens, model: target };
}

/** 拼一句给用户看的话 —— 让他知道学到了、下次不用再猜。 */
export function describeLearnedContextWindow(learned: LearnedContextWindow): string {
  return `（已从本次报错学到 ${learned.model} 的上下文窗口 = ${learned.tokens} token，已保存到模型配置）`;
}
