/**
 * Simple in-memory file lock for preventing concurrent writes to the same file.
 * This is sufficient for single-process Node.js environments.
 */

const locks = new Map<string, Promise<void>>();

/**
 * Acquire a lock for a specific file path.
 * Returns a release function that must be called when done.
 */
export async function acquireFileLock(filePath: string): Promise<() => void> {
  // Wait for any existing lock on this file
  while (locks.has(filePath)) {
    await locks.get(filePath);
  }

  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = () => {
      locks.delete(filePath);
      resolve();
    };
  });

  locks.set(filePath, lockPromise);
  return releaseLock!;
}

/**
 * Execute a function with a file lock.
 * Automatically acquires and releases the lock.
 */
export async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const release = await acquireFileLock(filePath);
  try {
    return await fn();
  } finally {
    release();
  }
}
