export function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function lsSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function lsRemove(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function lsGetJson<T>(key: string): T | null
export function lsGetJson<T>(key: string, fallback: T): T
export function lsGetJson<T>(key: string, fallback?: T): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback ?? null;
    return JSON.parse(raw) as T;
  } catch {
    return fallback ?? null;
  }
}

export function lsSetJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
