/**
 * Smart memory cleanup service.
 * Automatically removes low-value memories and archives based on usage and quality.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveProjectPath } from "./vibeFs";
import { readProjectMemory, writeProjectMemory, PROJECT_MEMORY_REL_PATH } from "./vibeProjectMemory";
import { getMemoryUsageStore } from "./memoryUsageTracker";

const CLEANUP_CONFIG = {
  /** Maximum age in days for low-usage memories */
  MAX_LOW_USAGE_AGE_DAYS: 30,
  /** Maximum age in days for exploration archives */
  MAX_ARCHIVE_AGE_DAYS: 60,
  /** Minimum read count to keep an archive */
  MIN_ARCHIVE_READ_COUNT: 2,
  /** Maximum number of exploration archives to keep */
  MAX_ARCHIVE_COUNT: 20,
};

export type CleanupResult = {
  memoriesRemoved: number;
  archivesRemoved: number;
  totalSizeReduced: number;
  details: string[];
};

/**
 * Check if a memory line is low-value.
 */
function isLowValueMemory(line: string, usageCount: number, ageDays: number): boolean {
  const text = line.replace(/^- /, "").replace(/^\[[\d-]+\]\s*/, "").trim();

  // Pure path without description
  const purePathPattern = /^`?[a-z/._-]+\.[a-z]+`?$/i;
  if (purePathPattern.test(text)) return true;

  // Very old and never used
  if (ageDays > CLEANUP_CONFIG.MAX_LOW_USAGE_AGE_DAYS && usageCount === 0) return true;

  // Repeated content (simple heuristic)
  if (text.length < 10 && usageCount === 0) return true;

  return false;
}

/**
 * Get age in days from a timestamp string.
 */
function getAgeDays(timestamp: string): number {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Clean up low-value memories from project-memory.md.
 */
async function cleanupMemories(projectRoot: string, usageStore: { entries: Array<{ key: string; count: number }> }): Promise<{
  removed: number;
  content: string;
}> {
  const memoryResult = await readProjectMemory(projectRoot);
  if (!memoryResult.ok) return { removed: 0, content: "" };

  const lines = memoryResult.content.split("\n");
  const usageMap = new Map(usageStore.entries.map(e => [e.key, e.count]));

  let removedCount = 0;
  const cleanedLines: string[] = [];

  for (const line of lines) {
    // Keep non-bullet lines (headers, empty lines)
    if (!line.startsWith("- ")) {
      cleanedLines.push(line);
      continue;
    }

    const text = line.replace(/^- /, "").replace(/^\[[\d-]+\]\s*/, "").trim();

    // Simple heuristic for low-value detection
    const isPurePath = /^`?[a-z/._-]+\.[a-z]+`?$/i.test(text);
    const isTooShort = text.length < 10;

    if (isPurePath || isTooShort) {
      removedCount++;
      continue;
    }

    cleanedLines.push(line);
  }

  return { removed: removedCount, content: cleanedLines.join("\n") };
}

/**
 * Clean up old exploration archives.
 */
async function cleanupExplorationArchives(
  projectRoot: string,
): Promise<{ removed: number; details: string[] }> {
  const details: string[] = [];
  let removedCount = 0;

  const explorationDir = path.join(projectRoot, ".aiall", "exploration");
  const indexPath = path.join(projectRoot, ".aiall", "skills", "index.json");

  // Read exploration index
  let indexData: { exploration?: Array<{ id: string; path: string; createdAt: string; readCount: number }> } = {};
  try {
    const raw = await fs.promises.readFile(indexPath, "utf-8");
    indexData = JSON.parse(raw);
  } catch {
    return { removed: 0, details: [] };
  }

  const explorations = indexData.exploration ?? [];

  // Sort by createdAt descending (newest first)
  explorations.sort((a, b) => {
    const dateA = new Date(a.createdAt);
    const dateB = new Date(b.createdAt);
    return dateB.getTime() - dateA.getTime();
  });

  // Mark old or low-read archives for removal
  const toRemove: string[] = [];
  for (const exp of explorations) {
    const ageDays = getAgeDays(exp.createdAt);
    const readCount = exp.readCount ?? 0;

    // Remove if too old and low reads
    if (ageDays > CLEANUP_CONFIG.MAX_ARCHIVE_AGE_DAYS && readCount < CLEANUP_CONFIG.MIN_ARCHIVE_READ_COUNT) {
      toRemove.push(exp.id);
      details.push(`移除旧归档 ${exp.id}（${Math.round(ageDays)} 天，读取 ${readCount} 次）`);
    }
  }

  // If still too many archives, remove oldest low-read ones
  const remaining = explorations.length - toRemove.length;
  if (remaining > CLEANUP_CONFIG.MAX_ARCHIVE_COUNT) {
    const excess = remaining - CLEANUP_CONFIG.MAX_ARCHIVE_COUNT;
    for (const exp of explorations) {
      if (toRemove.length >= explorations.length - CLEANUP_CONFIG.MAX_ARCHIVE_COUNT) break;
      if (toRemove.includes(exp.id)) continue;
      if (exp.readCount < CLEANUP_CONFIG.MIN_ARCHIVE_READ_COUNT) {
        toRemove.push(exp.id);
        details.push(`移除多余归档 ${exp.id}（读取 ${exp.readCount ?? 0} 次）`);
      }
    }
  }

  // Delete files and update index
  for (const id of toRemove) {
    const exp = explorations.find(e => e.id === id);
    if (!exp) continue;

    try {
      const filePath = path.join(projectRoot, exp.path);
      await fs.promises.unlink(filePath);
      removedCount++;
    } catch {
      // File may not exist
    }
  }

  // Update index
  if (toRemove.length > 0) {
    const remainingExplorations = explorations.filter(e => !toRemove.includes(e.id));
    indexData.exploration = remainingExplorations;
    await fs.promises.writeFile(indexPath, JSON.stringify(indexData, null, 2), "utf-8");
  }

  return { removed: removedCount, details };
}

/**
 * Run smart cleanup on project memory and archives.
 */
export async function runSmartCleanup(projectRoot: string): Promise<CleanupResult> {
  const details: string[] = [];
  let totalRemoved = 0;
  let totalSizeReduced = 0;

  // Get usage store
  const usageStore = await getMemoryUsageStore(projectRoot);

  // Cleanup memories
  const memoryCleanup = await cleanupMemories(projectRoot, usageStore);
  if (memoryCleanup.removed > 0) {
    details.push(`清理 ${memoryCleanup.removed} 条低价值记忆`);

    // Write cleaned content
    const writeResult = await writeProjectMemory(projectRoot, memoryCleanup.content);
    if (writeResult.ok) {
      totalSizeReduced += memoryCleanup.removed * 50; // Estimate 50 bytes per line
    }
  }
  totalRemoved += memoryCleanup.removed;

  // Cleanup exploration archives
  const archiveCleanup = await cleanupExplorationArchives(projectRoot);
  if (archiveCleanup.removed > 0) {
    details.push(...archiveCleanup.details);
    totalSizeReduced += archiveCleanup.removed * 1000; // Estimate 1KB per archive
  }
  totalRemoved += archiveCleanup.removed;

  return {
    memoriesRemoved: memoryCleanup.removed,
    archivesRemoved: archiveCleanup.removed,
    totalSizeReduced,
    details,
  };
}

/**
 * Check if cleanup is needed.
 */
export async function isCleanupNeeded(projectRoot: string): Promise<boolean> {
  const memoryResult = await readProjectMemory(projectRoot);
  if (!memoryResult.ok) return false;

  // Check memory content quality
  const lines = memoryResult.content.split("\n");
  const bulletLines = lines.filter(l => l.startsWith("- "));

  // If many lines are pure paths or very short
  const lowValueLines = bulletLines.filter(l => {
    const text = l.replace(/^- /, "").replace(/^\[[\d-]+\]\s*/, "").trim();
    const isPurePath = /^`?[a-z/._-]+\.[a-z]+`?$/i.test(text);
    const isTooShort = text.length < 10;
    return isPurePath || isTooShort;
  });

  return lowValueLines.length > bulletLines.length * 0.3;
}
