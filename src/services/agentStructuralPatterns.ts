/**
 * Structural patterns for agent orchestration — shape / syntax only, no business nouns.
 * Shared by intent classifiers, trace guards, and topic modules.
 */

/** Prior assistant listed enum/constant definitions (not runtime branches). */
export const PRIOR_DEFINITION_LISTING_RE =
  /(?:=\s*\d+|枚举|\benum\b|共有\s*(?:三|几|\d+)\s*(?:种|个)|`[A-Za-z_]\w*`\s*=\s*\d+)/i;

/** Tokens that look like definition lines when repeated without usage evidence. */
export const DEFINITION_VALUE_TOKEN_RE =
  /(?:=\s*\d+|`[^`]+`\s*=\s*\d+|\b=\s*0\b|\b=\s*1\b|\b=\s*2\b)/gi;

/** Scheduled/cron job topic in user message (not implement intent). */
export const SCHEDULED_TASK_TOPIC_RE =
  /(?:有没有|是否有|有无).{0,32}(?:定时|调度|cron|Cron|周期)|(?:定时|调度).{0,24}(?:任务|job|Job|触发)|\bcron\b|何时执行|什么时候跑|几点执行|执行频率|多久执行一次/i;

/** Whole-repo / app purpose overview (not a single symbol). */
export const PROJECT_OVERVIEW_TOPIC_RE =
  /(?:项目|仓库|代码库|应用).{0,12}(?:做什么|是啥|是什么|介绍|概览|用途)|(?:解释|介绍|说明).{0,8}(?:项目|仓库|应用)/;

/** User pasted session-quality audit task (marker shape, not a feature name). */
export const SESSION_AUDIT_TASK_RE =
  /【任务】请自行排查以下\s*.+\s*会话|Agent\s*回复的准确度|会话文件.*chat-\d{10,}/i;

/** Git working tree / staged changes overview (not implement intent). */
export const GIT_WORKING_TREE_TOPIC_RE =
  /(?:\bgit\b|暂存|未提交|工作区|待提交|staged|unstaged|working\s*tree).{0,24}(?:改|变|diff|状态|提交|啥|什么)|(?:改了啥|改了什么|有哪些改动)|\bgit\s+status\b/i;

export function isGitWorkingTreeTopicPrompt(prompt: string): boolean {
  const text = prompt.trim();
  return Boolean(text && GIT_WORKING_TREE_TOPIC_RE.test(text));
}

export const JOB_FILE_PATH_RE = /([^/\\]+Job)\.cs$/i;

/** Stack-agnostic schedule registration markers. */
export const GENERIC_SCHEDULE_REGISTRATION_RE =
  /ScheduleJob|AddJob|Schedule.*Job|cron\.schedule|node-cron|@Cron|registerSchedule|setInterval/i;

/** .NET / Quartz registration markers — use only when hasDotNetProject. */
export const DOTNET_SCHEDULE_REGISTRATION_RE =
  /CronSchedule|TriggerBuilder|WithCronSchedule|IScheduler|IJobDetail|Startup/i;

export function scheduleRegistrationPatternMatches(
  grepBlob: string,
  hasDotNetProject = false,
): boolean {
  if (GENERIC_SCHEDULE_REGISTRATION_RE.test(grepBlob)) return true;
  return hasDotNetProject && DOTNET_SCHEDULE_REGISTRATION_RE.test(grepBlob);
}

/** Assistant reply cited a code location or style evidence (generic). */
export function assistantProvidedCodeLocationEvidence(text: string): boolean {
  return (
    /\.(?:vue|tsx?|jsx?|cs|scss|css)\b/i.test(text) ||
    /(?:background|opacity|backdrop-filter|var\(--)/i.test(text) ||
    /找到了|已定位|位于\s+`/.test(text)
  );
}

export function extractJobClassNamesFromReadPaths(readPaths: string[]): string[] {
  const names = new Set<string>();
  for (const raw of readPaths) {
    const normalized = raw.replace(/\\/g, "/").trim();
    const match = JOB_FILE_PATH_RE.exec(normalized);
    if (match?.[1]) names.add(match[1]);
  }
  return [...names];
}

export function hasScheduleRegistrationEvidence(
  readPaths: string[],
  grepPatterns: string[],
  hasDotNetProject = false,
): boolean {
  const normalizedReads = readPaths.map((p) => p.replace(/\\/g, "/"));
  if (hasDotNetProject && normalizedReads.some((p) => /startup/i.test(p))) return true;
  const grepBlob = grepPatterns.join("\n");
  if (scheduleRegistrationPatternMatches(grepBlob, hasDotNetProject)) return true;
  const jobNames = extractJobClassNamesFromReadPaths(readPaths);
  if (jobNames.some((name) => grepPatterns.some((pattern) => pattern.includes(name)))) return true;
  return false;
}

export function shouldNudgeScheduledJobRegistration(
  readPaths: string[],
  grepPatterns: string[],
  hasDotNetProject = false,
): boolean {
  const jobNames = extractJobClassNamesFromReadPaths(readPaths);
  if (!jobNames.length) return false;
  return !hasScheduleRegistrationEvidence(readPaths, grepPatterns, hasDotNetProject);
}
