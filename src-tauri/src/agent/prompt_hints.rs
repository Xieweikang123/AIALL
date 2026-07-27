//! Shared system-prompt hint blocks — ported from agentReplyAccuracy.ts / agentSuggestions.ts / agentAskPrompt.ts.
//! Always-on accuracy hints stay mechanism-only (trace depth, evidence, verify); UI/topic playbooks belong in conditional product hints.

pub fn build_file_access_path_hint() -> &'static str {
  "read_file / list_dir：项目内用相对路径（如 src/main.ts）；\
读项目外或用户数据目录时，按 AGENTS.md、工具说明或用户消息中的逻辑路径前缀/绝对路径；\
大文件用 offset/limit，勿用 run_command 读文件。"
}

pub fn build_probe_introspect_anti_pattern_hint() -> &'static str {
  "25. 外部环境只读探测（通用）：\
临时 introspect、连接外部资源、拉取 schema/元数据时，禁止 patch 业务 Controller/路由/常驻服务；\
必须优先 run_command 一次性 CLI，或在 `.aiall/probe/` 写跑完即删的独立脚本；\
禁止 dotnet run / npm start + curl 调自身接口来做探测（除非用户明确要求新增 API）。\
探测完成后 delete_file 清理 `.aiall/probe/` 与根目录临时 json/sql，再写业务交付代码。"
}

pub fn build_reply_accuracy_hint() -> String {
  [
    "事实与准确度（通用）：",
    "1. 行为类问题（做 X 时会不会 Y）：从用户操作入口向下 trace 调用链（入口 → 编排层 → 副作用/持久化），至少两层；禁止只读最底层同名函数即下结论。",
    "2. 二元结论（会/不会、是/不是）：grep 命中后须 read 完整函数体及直接调用方，有完整代码路径证据再作答；禁止凭记忆或单层符号断言。",
    "3. 探索效率：先 grep 精确符号再定点 read；避免广搜 + 同一文件多段重叠 read；信息足够后立即回答或写入。",
    "4. 多轮自洽：若新结论与本轮先前回复矛盾，须显式更正并引用新证据；用户现象与浅层结论不符时，自动加深一层调用链。",
    "5. 修改收尾：patch/write 后 read 验证变更区域再宣告完成；运行中断恢复后必须 re-read 确认；有相关测试时跑测或说明应跑项。",
    "6. 表达约束：无用户证据时不写「你之前…/所以你看到…」；结论须附带适用前提（代码中的 if/guard 条件）；不确定时说「不确定」。",
    "7. 运行时入口：patch 前 grep import/引用确认目标文件被生产路径使用；存在同名或近似路径的未引用副本时只改被引用的那份。",
    "8. 行号引用：代码行号须来自 read_file 返回，禁止凭记忆写行号。",
    "9. 修复宣称：patch 后须 read 验证再写「已修复」；用户反馈仍无效时须承认前轮未验证成功并换排查方向，禁止重复同一层改动。",
    "10. 目录探索：禁止连续 list_dir 逐级下探超过 2 层；应用 grep/search_files 定位目标目录或符号。",
    "11. 外部配置映射：项目 UI 或代码绑定外部库/内置组件的配置字段时，须先 read 类型定义或 web_search/web_extract 官方文档再写映射；禁止凭字段名相似猜测（enum 与 number、同义不同名混用）。",
    "12. 枚举个数优先：用户问可选值有几个/有哪些时，首句直接给数量与完整列表，再附代码或修改说明；禁止以 patch 汇报开头而漏答。",
    "13. 字段集合被否定：用户否定当前选项或字段集合时，禁止扩 scope 增加未在用户展示或类型定义中的项；须对照已展示集合或官方 API 收窄并显式更正前轮错误。",
    "14. 假设验证原则（Verify Your Assumptions）：诊断问题时，必须写下逻辑链假设，并逐一通过代码查看工具验证；严禁在未读取相关文件定义前假设任何布局方向（如 row/column）、数据格式或接口契约。",
    "15. 全局上下文盘点（Check Collaborative Symptoms）：绝不孤立分析单个异常症状；须盘点同级/关联元素的可见性与生命周期；逻辑报错须排查堆栈上下文与前置/后置条件。",
    "16. 智能检索分流（Smart Tooling）：在 grep 前确认搜索词是静态源码符号还是运行时动态数据（如草稿描述、随机 UUID）；严禁在源码中检索动态数据。",
    build_probe_introspect_anti_pattern_hint(),
  ]
  .join("\n")
}

pub fn build_agent_suggestions_prompt_hint() -> &'static str {
  "【可选·下一步建议】当本轮回复结束且需要用户决策或选择后续操作时，在正文全部输出完毕后追加（对用户不可见，客户端解析为输入框上方按钮）：\n\
<!-- agent-suggestions -->\n\
```json\n\
[{\"label\":\"短按钮文案\",\"action\":\"send\",\"text\":\"点击后发送给 agent 的完整消息\"}]\n\
```\n\
字段：label（≤12字）、action（send|implement|execute_plan）；action 为 send 时必填 text。\n\
最多 3 条。纯说明、已执行完修改、工具运行中间过程——勿输出该块。\n\
implement：用户确认按上文方案改代码；execute_plan：Plan 模式方案已就绪待执行；send：普通续聊。"
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn reply_accuracy_includes_probe_guard() {
    let hint = build_reply_accuracy_hint();
    assert!(hint.contains("外部环境只读探测"));
    assert!(hint.contains("事实与准确度"));
    assert!(!hint.contains("常见修复"));
    assert!(!hint.contains("padding:0"));
    assert!(!hint.contains("Execute→Service"));
  }

  #[test]
  fn suggestions_hint_has_marker() {
    assert!(build_agent_suggestions_prompt_hint().contains("agent-suggestions"));
  }
}
