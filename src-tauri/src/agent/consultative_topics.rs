//! Consultative topic system hints (ported from agentConsultativeTopics.ts + userIntentHints.ts).

use super::context::HistoryMessage;
use super::policy::{AgentRunPolicy, UserIntent};

static SCHEDULED_TASK_TOPIC_RE: once_cell::sync::Lazy<regex::Regex> =
  once_cell::sync::Lazy::new(|| {
    regex::Regex::new(
      r"(?:有没有|是否有|有无).{0,32}(?:定时|调度|cron|Cron|周期)|(?:定时|调度).{0,24}(?:任务|job|Job|触发)|\bcron\b|何时执行|什么时候跑|几点执行|执行频率|多久执行一次",
    )
    .unwrap()
  });

static PROJECT_OVERVIEW_TOPIC_RE: once_cell::sync::Lazy<regex::Regex> =
  once_cell::sync::Lazy::new(|| {
    regex::Regex::new(
      r"(?:项目|仓库|代码库|应用).{0,12}(?:做什么|是啥|是什么|介绍|概览|用途)|(?:解释|介绍|说明).{0,8}(?:项目|仓库|应用)",
    )
    .unwrap()
  });

static SESSION_AUDIT_TASK_RE: once_cell::sync::Lazy<regex::Regex> =
  once_cell::sync::Lazy::new(|| {
    regex::Regex::new(
      r"【任务】请自行排查以下\s*.+\s*会话|Agent\s*回复的准确度|会话文件.*chat-\d{10,}",
    )
    .unwrap()
  });

static GIT_WORKING_TREE_TOPIC_RE: once_cell::sync::Lazy<regex::Regex> =
  once_cell::sync::Lazy::new(|| {
    regex::Regex::new(
      r"(?:\bgit\b|暂存|未提交|工作区|待提交|staged|unstaged|working\s*tree).{0,24}(?:改|变|diff|状态|提交|啥|什么)|(?:改了啥|改了什么|有哪些改动)|\bgit\s+status\b",
    )
    .unwrap()
  });

static IMPLEMENTATION_STATUS_RE: once_cell::sync::Lazy<regex::Regex> =
  once_cell::sync::Lazy::new(|| {
    regex::Regex::new(
      r"(?:改完|改好了|弄完|做完|完成了吗|好了吗|搞定了吗|是否已经|有没有改|是否已经改|进度|实施完|落地完)",
    )
    .unwrap()
  });

static JOB_FILE_PATH_RE: once_cell::sync::Lazy<regex::Regex> =
  once_cell::sync::Lazy::new(|| regex::Regex::new(r"([^/\\]+Job)\.cs$").unwrap());

static SCHEDULE_REGISTRATION_RE: once_cell::sync::Lazy<regex::Regex> =
  once_cell::sync::Lazy::new(|| {
    regex::Regex::new(
      r"ScheduleJob|AddJob|Schedule.*Job|cron\.schedule|node-cron|@Cron|registerSchedule|setInterval|CronSchedule|TriggerBuilder|WithCronSchedule|IScheduler|IJobDetail|Startup",
    )
    .unwrap()
  });

const TOPIC_IDS: &[&str] = &[
  "session_audit",
  "scheduled_task",
  "project_overview",
  "git_working_tree",
  "behavior_purpose",
  "behavior_contradiction",
  "accuracy",
  "code_review",
  "implementation_status",
  "step_clarification",
  "config_binding",
];

pub fn build_scheduled_task_consultative_hint() -> &'static str {
  "\n【定时/调度类】用户问的是有无定时任务、何时触发、执行频率等。\n\
   read 到 job/task 实现后，须继续 trace 到调度注册/触发配置处并 read；符号与入口路径依上方【项目上下文】JSON 与 manifest 自行选用，勿凭记忆臆测。\n\
   禁止只 trace Execute→Service 即收工；答案须含触发时机/频率（代码中有则写明）。\n\
   探索时避免连续 list_dir 逐级下探超过 2 层，优先 grep/search_files 定位调度注册文件。"
}

pub fn build_project_overview_consultative_hint() -> &'static str {
  "\n【项目概览】用户问的是整个应用/仓库做什么，不是某个函数行为。\n\
   1. 优先引用 system 已注入的【项目上下文】JSON 中的 routes 与 AGENTS.md 产品入口；\n\
   2. 仅当摘要不足时再 read 路由入口或各 view 首屏 desc（offset/limit 约 1–80 行）；\n\
   3. 回答按「入口 → 用途」逐项说明全部顶层路由，勿只深挖单一子系统；\n\
   4. 已注入的项目上下文 JSON 勿重复 read_file 相同 manifest；\n\
   5. 禁止用单一产品类比替代多入口说明。"
}

pub fn build_code_review_consultative_hint() -> &'static str {
  "\n【代码核对·只读】用户要求检查/核对/验证代码或改动，不是新实施请求。\n\
   须 read_file 核对目标文件实际内容后作答；禁止仅凭记忆或截图断言「已正确」。"
}

pub fn build_git_working_tree_consultative_hint() -> &'static str {
  "\n【Git 工作区】用户问未提交/暂存变更。须先 git_status 列出文件，再用 git_diff 查看具体 diff。\n\
   区分已暂存、未暂存、未跟踪；回答时概括每个文件的改动要点。\n\
   禁止声称无法执行 Git 或要求用户粘贴 git status；禁止用 read_file 代替 diff 来猜测变更。"
}

pub fn build_implementation_status_hint() -> &'static str {
  "\n【实施进度追问】用户在问前述改动是否已完成。\n\
   只读 grep/read 核对仓库现状后直接回答进度；禁止 patch_file / write_file。\n\
   禁止称 Ask 模式或让用户切换 Build（当前为 Build 模式的咨询只读轮）。"
}

pub fn build_consultative_build_hint() -> &'static str {
  "\n【咨询任务·只读】用户本条仅为提问/解释，未要求改代码。\n\
   只允许 list_dir / read_file / grep / search_files；禁止 patch_file / write_file / delete_file。\n\
   优先 grep 精确符号；「会不会/是否/做 X 时会不会 Y/准确吗」须 trace 入口→编排层→副作用或 prompt 构造处，read 目标函数及至少一层直接调用方后再答；禁止只读 composable 即下结论。\n\
   准确度/输出质量类：须 read 到 backend 路由或 middleware 中实际 prompt/数据拼装处，说明代码里注入了哪些上下文；禁止用「如果 prompt 包含…」猜测。\n\
   勿广搜或同一文件多段重叠 read；信息足够后立即用自然语言回答「当前代码下会怎样」，勿连环读取无关文件。\n\
   禁止在未对照工具结果前宣称「逻辑已正确/无需再改/链路完整」；需要改代码时说明结论并请用户发送明确实施指令。\n\
   禁止在咨询结论末尾主动推销 patch（如「需要我调整…吗」）；用户未要求改代码时勿反问要不要改。\n\
   若写工具返回「Build 只读轮」相关错误：当前仍是 Build 模式，只是本条被标为咨询只读；禁止向用户称 Ask 模式或让用户切换 Build。"
}

pub fn build_consultative_resume_hint(behavior_purpose: bool) -> String {
  let mut lines = vec![
    "【咨询续跑·只读】原始消息仅为提问/解释，未要求改代码。".to_string(),
    "请根据下方已完成的 grep/read 证据直接回答原始问题；禁止 patch_file / write_file / delete_file。".to_string(),
    "禁止宣称「上一轮的 patch 已生效/无需再改/逻辑已正确」——须基于当前磁盘代码说明结论；若曾误执行写操作，说明现状即可，勿重复 patch。".to_string(),
    "若原始问题为准确度/是否类且尚未 read backend/middleware 的 prompt 构造：须补齐该层 read 后再答；禁止「基于已有信息直接回答」或反问用户要不要继续查。".to_string(),
  ];
  if behavior_purpose {
    lines.push(
      "原始问题为用途/作用类：须基于下方已 read 的分支逻辑作答（条件→副作用），禁止重复枚举定义或写「可能需要查看引用」。".into(),
    );
  }
  lines.push("相同文件区域禁止再 read_file；最多 1 次 grep 补齐遗漏。".into());
  lines.join("\n")
}

pub fn build_scheduled_job_registration_nudge(job_class_names: &[String]) -> String {
  let listed = job_class_names.iter().take(2).cloned().collect::<Vec<_>>().join("、");
  let first = job_class_names.first().map(String::as_str).unwrap_or("Job");
  format!(
    "【系统提示】你已 read Job 类（{listed}），但尚未 read/grep 调度注册处。\n\
     下一轮 grep `{first}` 并 trace 到调度注册/触发配置（符号依【项目上下文】JSON）；read 注册入口后再作答。\n\
     作答须含触发时机/频率（如 cron、启动即跑）；禁止只写 Execute→Service 业务逻辑即结束。"
  )
}

fn topic_hint(id: &str, prompt: &str) -> String {
  match id {
    "session_audit" => super::intent_hints::build_session_audit_hint().to_string(),
    "scheduled_task" => build_scheduled_task_consultative_hint().to_string(),
    "project_overview" => build_project_overview_consultative_hint().to_string(),
    "git_working_tree" => build_git_working_tree_consultative_hint().to_string(),
    "behavior_purpose" => super::consultative_trace::build_behavior_purpose_trace_hint(),
    "behavior_contradiction" => super::intent_hints::build_behavior_contradiction_hint().to_string(),
    "accuracy" => super::consultative_trace::build_consultative_accuracy_trace_hint(),
    "code_review" => build_code_review_consultative_hint().to_string(),
    "implementation_status" => build_implementation_status_hint().to_string(),
    "step_clarification" => super::intent_hints::build_agent_step_clarification_hint().to_string(),
    "config_binding" => config_binding_hint(prompt).to_string(),
    _ => String::new(),
  }
}

fn config_binding_hint(prompt: &str) -> &'static str {
  match resolve_config_binding_topic(prompt) {
    Some("reject") => {
      "\n【外部配置·准确度】绑定外部库或内置组件配置字段时，须 read 类型定义或 web_extract 官方文档；禁止凭字段名相似猜测。\n\
       用户否定当前字段/选项集合：禁止扩 scope；对照用户已展示项或类型定义收窄，显式更正前轮映射错误。"
    }
    Some("enumeration") => {
      "\n【外部配置·准确度】绑定外部库或内置组件配置字段时，须 read 类型定义或 web_extract 官方文档；禁止凭字段名相似猜测。\n\
       用户问可选值个数或列表：首句写「共 N 个：…」完整列表，再附代码；禁止以 patch 汇报开头漏答。"
    }
    Some("doc_lookup") => {
      "\n【外部配置·准确度】绑定外部库或内置组件配置字段时，须 read 类型定义或 web_extract 官方文档；禁止凭字段名相似猜测。\n\
       用户要求查官方定义：须 web_search + web_extract 后再改映射；回答含字段名与类型/枚举对照。"
    }
    None | Some(_) => "",
  }
}

fn resolve_config_binding_topic(prompt: &str) -> Option<&'static str> {
  let text = prompt.trim();
  if text.is_empty() {
    return None;
  }
  static REJECT_RE: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
    regex::Regex::new(
      r"(?:不对|不是这个|不要这个|错了|搞错|映射错|选项不对|没有这个选项|不在列表|列表里没有)",
    )
    .unwrap()
  });
  static ENUM_RE: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
    regex::Regex::new(
      r"(?:几个|多少|几种|几个选项|有哪些选项|可选值|枚举值|选项列表)",
    )
    .unwrap()
  });
  static DOC_RE: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
    regex::Regex::new(
      r"(?:官方文档|文档怎么说|查文档|API文档|文档里|spec|规范)",
    )
    .unwrap()
  });
  static CONFIG_CTX_RE: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
    regex::Regex::new(
      r"(?:字段|属性|参数|配置|选项|枚举|映射|绑定|prop|Props|attribute)",
    )
    .unwrap()
  });
  if REJECT_RE.is_match(text) && CONFIG_CTX_RE.is_match(text) {
    return Some("reject");
  }
  if ENUM_RE.is_match(text) && CONFIG_CTX_RE.is_match(text) {
    return Some("enumeration");
  }
  if DOC_RE.is_match(text) && CONFIG_CTX_RE.is_match(text) {
    return Some("doc_lookup");
  }
  None
}

fn history_suggests_active_implementation(history: Option<&[HistoryMessage]>) -> bool {
  let text: String = history
    .unwrap_or(&[])
    .iter()
    .rev()
    .take(8)
    .map(|m| m.content.as_str())
    .collect::<Vec<_>>()
    .into_iter()
    .rev()
    .collect::<Vec<_>>()
    .join("\n");
  if text.trim().is_empty() {
    return false;
  }
  regex::Regex::new(
    r"(?:改吧|实现吧|执行吧|继续改|动手吧|patch_file|write_file|已修改|修改方案|实施计划|下一步需要|部分改好|未完成|须改代码|让我完成|剩余(?:的)?实现|需要我(?:实际)?执行|请确认优先级)",
  )
  .unwrap()
  .is_match(&text)
}

fn topic_is_active(
  id: &str,
  prompt: &str,
  history: Option<&[HistoryMessage]>,
  user_intent: &UserIntent,
  policy: &AgentRunPolicy,
) -> bool {
  let text = prompt.trim();
  match id {
    "session_audit" => policy.session_audit_run || SESSION_AUDIT_TASK_RE.is_match(text),
    "scheduled_task" => {
      policy.scheduled_task_consultative_run
        || (SCHEDULED_TASK_TOPIC_RE.is_match(text) && user_intent.consultative)
    }
    "project_overview" => PROJECT_OVERVIEW_TOPIC_RE.is_match(text),
    "git_working_tree" => GIT_WORKING_TREE_TOPIC_RE.is_match(text),
    "behavior_purpose" => policy.behavior_purpose_run,
    "behavior_contradiction" => policy.behavior_contradiction_run,
    "accuracy" => policy.accuracy_consultative_run,
    "code_review" => policy.code_review_run,
    "implementation_status" => {
      IMPLEMENTATION_STATUS_RE.is_match(text) && history_suggests_active_implementation(history)
    }
    "step_clarification" => policy.agent_step_clarify_run,
    "config_binding" => resolve_config_binding_topic(text).is_some(),
    _ => false,
  }
}

pub fn resolve_active_consultative_topic_ids(
  prompt: &str,
  history: Option<&[HistoryMessage]>,
  user_intent: &UserIntent,
  policy: &AgentRunPolicy,
) -> Vec<&'static str> {
  if let Some(topic) = user_intent.consultative_topic.as_deref() {
    if topic != "none" && topic != "general" {
      if TOPIC_IDS.contains(&topic) {
        return TOPIC_IDS.iter().copied().filter(|id| *id == topic).collect();
      }
    }
  }
  TOPIC_IDS
    .iter()
    .copied()
    .filter(|id| topic_is_active(id, prompt, history, user_intent, policy))
    .collect()
}

pub fn build_consultative_topic_hints(
  prompt: &str,
  history: Option<&[HistoryMessage]>,
  user_intent: &UserIntent,
  policy: &AgentRunPolicy,
) -> String {
  let mut out = resolve_active_consultative_topic_ids(prompt, history, user_intent, policy)
    .into_iter()
    .map(|id| topic_hint(id, prompt))
    .collect::<String>();
  if super::consultative_trace::is_ui_state_behavior_question(prompt) {
    out.push_str(&super::consultative_trace::build_consultative_ui_behavior_trace_hint());
    out.push('\n');
  }
  out
}

pub fn extract_job_class_names_from_read_paths(read_paths: &[String]) -> Vec<String> {
  let mut names = std::collections::BTreeSet::new();
  for raw in read_paths {
    let normalized = raw.replace('\\', "/");
    if let Some(cap) = JOB_FILE_PATH_RE.captures(&normalized) {
      if let Some(name) = cap.get(1) {
        names.insert(name.as_str().to_string());
      }
    }
  }
  names.into_iter().collect()
}

pub fn has_schedule_registration_evidence(read_paths: &[String], grep_patterns: &[String]) -> bool {
  if read_paths.iter().any(|p| {
    let normalized = p.replace('\\', "/").to_lowercase();
    normalized.contains("startup")
      || normalized.contains("program.cs")
      || normalized.contains("scheduler")
      || normalized.contains("quartz")
      || normalized.contains("hangfire")
      || normalized.contains("cron")
  }) {
    return true;
  }
  let grep_blob = grep_patterns.join("\n");
  if SCHEDULE_REGISTRATION_RE.is_match(&grep_blob) {
    return true;
  }
  let job_names = extract_job_class_names_from_read_paths(read_paths);
  job_names.iter().any(|name| grep_patterns.iter().any(|p| p.contains(name)))
}

pub fn should_nudge_scheduled_job_registration(
  read_paths: &[String],
  grep_patterns: &[String],
) -> bool {
  let job_names = extract_job_class_names_from_read_paths(read_paths);
  !job_names.is_empty() && !has_schedule_registration_evidence(read_paths, grep_patterns)
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::agent::policy::{AgentMode, ResolvePolicyInput, UserIntent};

  #[test]
  fn resolves_session_audit_topic_from_policy() {
    let policy = super::super::policy::resolve_run_policy(ResolvePolicyInput {
      mode: AgentMode::Build,
      user_intent: UserIntent {
        consultative_topic: Some("session_audit".to_string()),
        ..Default::default()
      },
      ..Default::default()
    });
    let ids = resolve_active_consultative_topic_ids("", None, &UserIntent {
      consultative_topic: Some("session_audit".into()),
      ..Default::default()
    }, &policy);
    assert_eq!(ids, vec!["session_audit"]);
  }

  #[test]
  fn build_topic_hints_includes_scheduled_task() {
    let user_intent = UserIntent {
      consultative: true,
      consultative_topic: Some("scheduled_task".into()),
      scheduled_task: true,
      ..Default::default()
    };
    let policy = AgentRunPolicy {
      scheduled_task_consultative_run: true,
      ..Default::default()
    };
    let hints = build_consultative_topic_hints("有没有定时任务", None, &user_intent, &policy);
    assert!(hints.contains("定时/调度类"));
  }

  #[test]
  fn scheduled_job_nudge_when_job_read_without_registration() {
    let paths = vec!["src/Jobs/MyCleanupJob.cs".to_string()];
    assert!(should_nudge_scheduled_job_registration(&paths, &[]));
    assert_eq!(
      extract_job_class_names_from_read_paths(&paths),
      vec!["MyCleanupJob".to_string()],
    );
  }

  #[test]
  fn consultative_build_hint_mentions_read_only() {
    assert!(build_consultative_build_hint().contains("咨询任务·只读"));
  }
}
