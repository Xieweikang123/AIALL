/**
 * @deprecated Import from agentConsultativeTopics / agentStructuralPatterns instead.
 * Kept as thin re-exports for existing import paths.
 */
export {
  buildScheduledJobRegistrationNudge,
  buildScheduledTaskConsultativeHint,
  isScheduledTaskConsultativePrompt,
  isScheduledTaskTopicPrompt,
  shouldNudgeScheduledJobRegistration,
} from "./agentConsultativeTopics";

export { extractJobClassNamesFromReadPaths, hasScheduleRegistrationEvidence } from "./agentStructuralPatterns";
