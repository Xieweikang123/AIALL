export type GitFileDiff = {
  before: string;
  after: string;
  deleted?: boolean;
  created?: boolean;
};

export type { BatchGroup } from "../useGitBatchCommit";
