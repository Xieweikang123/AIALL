/** Generic reply-accuracy hints for Ask / Build / Plan system prompts. No business-specific terms. */
export function buildReplyAccuracyHint(): string {
  return [
    "事实与准确度（通用）：",
    "1. 行为类问题（做 X 时会不会 Y）：从用户操作入口向下 trace 调用链（入口 → 编排层 → 副作用/持久化），至少两层；禁止只读最底层同名函数即下结论。",
    "2. 二元结论（会/不会、是/不是）：grep 命中后须 read 完整函数体及直接调用方，有完整代码路径证据再作答；禁止凭记忆或单层符号断言。",
    "3. 探索效率：先 grep 精确符号再定点 read；避免广搜 + 同一文件多段重叠 read；信息足够后立即回答或写入。",
    "4. 多轮自洽：若新结论与本轮先前回复矛盾，须显式更正并引用新证据；用户现象与浅层结论不符时，自动加深一层调用链。",
    "5. 修改收尾：patch/write 后 read 验证变更区域再宣告完成；运行中断恢复后必须 re-read 确认；有相关测试时跑测或说明应跑项。",
    "6. 表达约束：无用户证据时不写「你之前…/所以你看到…」；结论须附带适用前提（代码中的 if/guard 条件）；不确定时说「不确定」。",
  ].join("\n");
}
