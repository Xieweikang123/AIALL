export interface GitGraphEntry {
  hash: string;
  parents?: string[];
}

export interface GitGraphConnection {
  fromLane: number;
  toLane: number;
}

export interface GitGraphRow<T extends GitGraphEntry> {
  entry: T;
  lane: number;
  lanesBefore: number[];
  lanesAfter: number[];
  connections: GitGraphConnection[];
}

/** Computes a stable, page-local commit graph without inventing missing parents. */
export function buildGitLogGraph<T extends GitGraphEntry>(entries: T[]): GitGraphRow<T>[] {
  const active: string[] = [];
  return entries.map((entry) => {
    const lanesBefore = active.map((_, index) => index);
    const existingLane = active.indexOf(entry.hash);
    const lane = existingLane >= 0 ? existingLane : 0;
    if (existingLane >= 0) active.splice(existingLane, 1);

    const parents = entry.parents || [];
    const connections: GitGraphConnection[] = [];
    if (parents.length) {
      for (const [index, parent] of parents.entries()) {
        const existing = active.indexOf(parent);
        if (existing >= 0) active.splice(existing, 1);
        const targetLane = Math.min(lane + index, active.length);
        active.splice(targetLane, 0, parent);
        connections.push({ fromLane: lane, toLane: targetLane });
      }
    }

    return {
      entry,
      lane,
      lanesBefore,
      lanesAfter: active.map((_, index) => index),
      connections,
    };
  });
}

export function graphLaneColor(lane: number): string {
  const colors = ["#58a6ff", "#bc8cff", "#3fb950", "#e3b341", "#f778ba", "#79c0ff"];
  return colors[Math.abs(lane) % colors.length];
}
