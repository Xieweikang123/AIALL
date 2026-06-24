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
  /(?:有没有|是否有|有无).{0,32}(?:定时|调度|cron|Cron|周期)|(?:定时|调度).{0,24}(?:任务|job|Job|触发)|\bcron\b|CronSchedule|何时执行|什么时候跑|几点执行|执行频率|多久执行一次/i;

export const JOB_FILE_PATH_RE = /([^/\\]+Job)\.cs$/i;

export const SCHEDULE_REGISTRATION_RE =
  /CronSchedule|TriggerBuilder|ScheduleJob|WithCronSchedule|IScheduler|IJobDetail|AddJob|Schedule.*Job/i;

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
): boolean {
  const normalizedReads = readPaths.map((p) => p.replace(/\\/g, "/"));
  if (normalizedReads.some((p) => /startup/i.test(p))) return true;
  const grepBlob = grepPatterns.join("\n");
  if (SCHEDULE_REGISTRATION_RE.test(grepBlob)) return true;
  const jobNames = extractJobClassNamesFromReadPaths(readPaths);
  if (jobNames.some((name) => grepPatterns.some((pattern) => pattern.includes(name)))) return true;
  return false;
}

export function shouldNudgeScheduledJobRegistration(
  readPaths: string[],
  grepPatterns: string[],
): boolean {
  const jobNames = extractJobClassNamesFromReadPaths(readPaths);
  if (!jobNames.length) return false;
  return !hasScheduleRegistrationEvidence(readPaths, grepPatterns);
}
