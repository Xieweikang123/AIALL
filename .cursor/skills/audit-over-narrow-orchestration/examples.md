# 过窄审查 — 反例与合格改写（占位符）

本文档**仅**用通用占位说明结构；不得把下列占位符以外的真实需求词写进 skill 或 rule。

---

## 1. 编排：正则 / 分支

**过窄**

```typescript
const PLAN_SIGNAL_RE = /粘贴图片|imageDataUrl|能否上传/;
if (/左侧图标/.test(userMessage)) return "ui_appearance";
```

**合格方向**

```typescript
// 形态：代码块 + 路径 + 非征求确认
const hasPlanShape = (text: string) =>
  /##\s*修改方案/.test(text) && extractPlanFilePaths(text).length > 0;
// 话题由用户消息 + 工具结果决定，不写在正则里
```

三问：换成「改路由 / 加重试」，上述合格方向仍成立；过窄版不成立。

---

## 2. System prompt 片段

**过窄**

```text
若用户问会话列表左侧警告图标，先打开 FilePanel.vue …
```

**合格方向**

```text
截图答疑：先用布局与元信息格式在代码中匹配渲染点，再解释符号含义。
行为类问题：入口 → 中间层 → 控制该 UI 的渲染条件；缺一层则写不确定。
```

---

## 3. 测试 fixture

**过窄**

```typescript
it("识别粘贴图片咨询", () => {
  expect(classify("能粘贴图片吗")).toBe("consultative");
});
```

**合格**

```typescript
it("分析型长文+提问不触发 execute_plan", () => {
  const analysis = "## 背景\n…\n是否需要我继续改 src/foo.ts？";
  expect(shouldExecutePlan(analysis)).toBe(false);
});
it("带路径与代码块的方案触发 execute_plan", () => {
  const plan = "## 修改方案\n```ts\n// src/foo.ts\n```";
  expect(shouldExecutePlan(plan)).toBe(true);
});
```

---

## 4. 会话审计 — 「改进建议」段

**过窄（个案处方）**

```markdown
## 改进建议
- 截图含「N条」时优先 read FilePanel.vue
- grep `session-item-interrupted` 后必须 read 该文件
- 撤销后图标会消失（未查 session.status）
```

**合格（机制版）**

```markdown
## 机制分类
| 机制 | 是否触发 |
| 视觉归属未与代码对齐 | 是 |
| 行为题 trace 不完整 | 是 |

## 可进仓库改动
- [x] 无（默认）
```

判错依据段**可以**写具体文件与行号；**改进建议**段只写机制。

---

## 5. 行为题：同层推断

**过窄结论**

「撤销会 splice 删除消息，所以左侧状态图标一定消失。」

**合格方向**

- 已核实：撤销入口删了哪些数据
- 须再核实：控制该图标显示的 **状态字段** 是否在 persist 路径上更新
- 二元结论附带 if/guard；缺证据则「不确定」，不用肯定语气包装猜测

---

## 6. Skill / Rule 自身

写 `SKILL.md` 或 `.mdc` 时：

- ✅ 用「列表项状态图标」「消息内恢复横幅」等**层级描述**
- ❌ 写「当用户问 X 功能时 grep Y 文件」
- ❌ 把某次 audit 里的真实会话标题、grep pattern 抄进 skill

若 examples 需要更新，只增**结构**反例，不增真实业务词。
