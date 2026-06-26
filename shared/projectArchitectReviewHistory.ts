import {
  PROJECT_ARCHITECT_REVIEW_HISTORY_DIR,
  PROJECT_ARCHITECT_REVIEW_STORE_FILE,
  PROJECT_ARCHITECT_REVIEW_HISTORY_MAX,
  reviewHistoryFileName,
  generateReviewId,
  type ArchitectReviewHistoryEntry,
  type ArchitectReviewStoreIndex,
  type ArchitectReviewVerdict,
} from "./projectArchitectReviewFormat";

export type { ArchitectReviewHistoryEntry, ArchitectReviewStoreIndex };

export type ReviewHistoryFileContent = {
  id: string;
  gitHead?: string;
  verdict?: ArchitectReviewVerdict;
  commitCount?: number;
  changedFileCount?: number;
  createdAt: string;
  body: string;
};

/** Create an empty store index. */
export function createEmptyStoreIndex(projectPath: string): ArchitectReviewStoreIndex {
  return {
    version: 1,
    projectPath,
    activeReviewId: "",
    reviews: [],
  };
}

/** Build a new history entry from review data. */
export function buildReviewHistoryEntry(options: {
  projectPath: string;
  body: string;
  gitHead?: string;
  verdict?: ArchitectReviewVerdict;
  commitCount?: number;
  changedFileCount?: number;
}): { entry: ArchitectReviewHistoryEntry; fileContent: ReviewHistoryFileContent } {
  const now = new Date();
  const id = generateReviewId(now);
  const file = reviewHistoryFileName(id);

  const entry: ArchitectReviewHistoryEntry = {
    id,
    gitHead: options.gitHead,
    verdict: options.verdict,
    commitCount: options.commitCount,
    changedFileCount: options.changedFileCount,
    createdAt: now.toISOString(),
    file,
  };

  const fileContent: ReviewHistoryFileContent = {
    id,
    gitHead: options.gitHead,
    verdict: options.verdict,
    commitCount: options.commitCount,
    changedFileCount: options.changedFileCount,
    createdAt: entry.createdAt,
    body: options.body,
  };

  return { entry, fileContent };
}

/** Append entry to index, enforcing max history limit. */
export function appendToStoreIndex(
  index: ArchitectReviewStoreIndex,
  entry: ArchitectReviewHistoryEntry,
): ArchitectReviewStoreIndex {
  const reviews = [entry, ...index.reviews];
  // Trim to max, but keep at least the most recent
  const trimmed = reviews.slice(0, PROJECT_ARCHITECT_REVIEW_HISTORY_MAX);
  return {
    ...index,
    reviews: trimmed,
    activeReviewId: entry.id,
  };
}

/** Remove an entry from the store index. */
export function removeFromStoreIndex(
  index: ArchitectReviewStoreIndex,
  reviewId: string,
): ArchitectReviewStoreIndex {
  const reviews = index.reviews.filter((r) => r.id !== reviewId);
  let activeReviewId = index.activeReviewId;
  if (activeReviewId === reviewId) {
    activeReviewId = reviews[0]?.id || "";
  }
  return {
    ...index,
    reviews,
    activeReviewId,
  };
}
