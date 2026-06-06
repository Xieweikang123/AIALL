/** True when delete failed only because the target path is already gone. */
export function isDeleteNotFoundError(error?: string): boolean {
  if (!error) return false;
  return /不存在|not found|enoent/i.test(error);
}
