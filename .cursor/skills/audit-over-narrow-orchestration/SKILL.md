---
name: audit-over-narrow-orchestration
description: >-
  Reviews agent orchestration, prompts, classifiers, test fixtures, and session-audit
  recommendations for case-specific boundaries that should stay generic. Use when
  editing vibeAgent, agentRunProfile, reply-accuracy prompts, PRs touching routing
  regexes, or when the user asks whether a rule, fix, or audit suggestion is too narrow.
disable-model-invocation: true
---

# 过窄审查（编排与复盘）

按需审查：**个案边界是否渗进全局**（编排代码、提示词、测试 fixture、审计「改进建议」）。

常驻约束见 `.cursor/rules/agent-orchestration.mdc` 与 `.cursor/rules/agent-reply-accuracy.mdc`；本 skill 只提供**审查步骤与输出格式**，不重复 rule 全文。

## 何时使用

- 改 `*RunProfile*`、`*Signal*`、`*Continuation*`、`*ReplyAccuracy*`、`*ExplorationHint*`、system prompt 分支
- 改分类正则、路由 if、咨询/Build 探索 nudge 文案
- 写或审 **Agent 会话准确度审计** 的「改进建议」段
- 用户问：「这样写是不是太窄」「会不会绑死本次需求」

## 不覆盖（除非用户明确要求）

- 泛化 code review（逻辑 bug、安全、性能）
- 用关键词 grep 脚本替代结构判断（易误报、本身过窄）

## 审查对象分类

开始前标定类型（可多种）：

| 类型 | 典型位置 | 「过窄」指什么 |
|------|----------|----------------|
| **编排 / 提示** | `server/vibeAgent.ts`、`server/agentRunProfile.ts`、`src/services/agentRunProfile.ts`、`agentReplyAccuracy.ts`、`agentAskPrompt.ts` | 正则/分支/prompt 绑具体功能、页面、字段、用户原话 |
| **测试 fixture** | `*RunProfile*.test.ts`、分类器/continuation 测试 | 用真实需求文案断言分类行为 |
| **复盘 / 审计输出** | 会话审计、postmortem、「改进建议」 | 个案处方（读某文件、搜某 pattern）写成全局规则 |
| **业务实现**（可选） | 产品代码 | 单点硬编码、不可复用特例；仅当用户点名审实现时展开 |

## 编排审查：优先扫哪些路径

按改动范围 read/grep，**用结构模式**（形态、层级名），不要用当前任务里的业务词当搜索锚点：

```
.cursor/rules/agent-orchestration.mdc
.cursor/rules/agent-reply-accuracy.mdc
server/vibeAgent.ts
server/agentRunProfile.ts
server/agentAskPrompt.ts
server/agentExplorationBudget.ts
src/services/agentRunProfile.ts
src/services/agentContinuation.ts
src/services/agentReplyAccuracy.ts
src/services/agentUserIntent.ts
**/*RunProfile*.ts
**/*ReplyAccuracy*.ts
**/*Signal*.ts
**/*Continuation*.ts
```

重点看：正则常量、路由分支、注入 nudge 字符串、测试 `it(` / fixture 用户消息。

## 工作流

```
1. 标定审查类型（编排 / fixture / 审计输出 / 可选业务代码）
2. 列出待审片段（diff、会话段落、或用户指定文件）
3. 对每条过 Code Review 三问（见下）
4. 机制分类：现象 vs 根因机制（机制才可进「改进建议」）
5. 输出三段：判据 | 机制 | 可进仓库改动（默认无）
6. 写完后自检：本 skill 产出里是否又引入个案词
```

**一行自检（写建议前必问）**：这是在改**机制**，还是在给**本案开处方**？

## Code Review 三问

**编排 / 提示 / fixture**（来自 agent-orchestration）：

1. 这条规则/常量里有没有具体功能名或本次需求的词？
2. 换成 unrelated 需求（如改路由、加重试），规则仍成立吗？
3. 分析回复里**提到**某标识符，会不会误触发？

**准确度 / 行为提示 / 审计建议**（来自 agent-reply-accuracy）：

1. 这条提示里有没有具体功能名或本次需求的词？
2. 换成 unrelated 需求，规则仍成立吗？
3. 分析回复里**提到**某标识符，会不会误导为唯一路径？

任一条为「是」且无充分理由 → 标为 **过窄**，给出**机制级**改写方向（不用新业务词替换旧业务词）。

## 过窄结构模式（认形状，不认话题）

| 模式 | 过窄表现 | 应收敛为 |
|------|----------|----------|
| 话题绑定 | 正则/prompt/if 含用户原话、页面名、API 字段 | 形态判断：代码块、步骤结构、路径、非征求确认句 |
| 标识符当唯一路径 | 「出现某符号即触发」无结构 guard | 多层条件 + 测试覆盖误触发 |
| 个案 fixture | 测试用户消息 = 某次真实提问 | `src/foo.ts`、`## 修改方案`、占位变量 |
| 审计处方 | 「下次先 read X / grep Y」 | trace 深度、归属对齐、矛盾更正等契约 |
| 同层推断 | 「数据删了所以 UI 没了」 | 入口 → 状态更新 → **渲染条件** 三层 |
| 概念混用 | 一个「图标/横幅」指两处 UI | 分开写状态存哪儿、谁读、是否同一控件 |

反例与合格改写见 [examples.md](examples.md)（均为占位，无真实功能名）。

## 输出模板

审计或审查报告**必须分三段**；第三段默认空是正常的。

```markdown
## 判错 / 过窄依据（可具体）

- 片段引用 + 为何过窄（可含文件路径与行号）
- 与代码/会话证据的对照

## 机制分类（抽象）

| 机制 | 是否触发 | 说明 |
|------|----------|------|
| 视觉归属未与代码对齐 | 是/否 | … |
| 行为题 trace 不完整 | 是/否 | … |
| 相近状态/概念混用 | 是/否 | … |
| 探索有线索未收敛/未更正 | 是/否 | … |
| 话题绑进全局规则 | 是/否 | … |
| 测试 fixture 绑真实需求 | 是/否 | … |

**机制结论（一句话）**：…

## 可进仓库改动

- [x] 无（默认）
- [ ] 有：仅写**通用**机制（如已有 hint/nudge/预算/矛盾更正是否应触发），并注明需过的三问

### 三问自检结果

1. …
2. …
3. …
```

## 修复方向（仅机制，禁止个案词）

过窄片段应改为：

- **结构契约**：步骤标题、 fenced 代码块、相对路径、确认/非确认句型
- **调用链深度**：行为题至少入口 → 中间层 → 副作用或渲染 guard
- **多轮自洽**：新证据与旧结论冲突时显式更正
- **已有 hook**：行为矛盾 hint、探索预算 nudge、grep 空结果 recovery——先考虑是否**应触发**而非新增话题词

不要：用另一个具体功能名替换原来的具体功能名。

## 与 Rule / AGENTS 的关系

| 层级 | 作用 |
|------|------|
| `.cursor/rules/*.mdc` | 始终生效的禁止项与契约 |
| 本 skill | 按需执行的审查清单与输出体裁 |
| `AGENTS.md` | 术语与路径索引；审查时不把术语表里的映射写进全局 prompt |

## 附加资源

- 占位符反例与合格改写：[examples.md](examples.md)
