import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildProjectSkillsPromptBlock,
  ensureDefaultProjectSkills,
  listProjectSkills,
  readProjectSkill,
  upsertProjectSkill,
  archiveExplorationNote,
} from "./vibeProjectSkills";
import { PROJECT_SKILLS_DIR } from "../src/services/projectSkills";

describe("vibeProjectSkills", () => {
  let tmpDir = "";

  afterEach(async () => {
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
      tmpDir = "";
    }
  });

  async function makeProject(): Promise<string> {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "aiall-skills-"));
    return tmpDir;
  }

  it("seeds default skills on first list", async () => {
    const root = await makeProject();
    const listed = await listProjectSkills(root);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.skills.length).toBeGreaterThanOrEqual(2);
    expect(listed.skills.some((s) => s.slug === "patch-from-read")).toBe(true);

    const skillPath = path.join(root, PROJECT_SKILLS_DIR, "patch-from-read.md");
    expect(fs.existsSync(skillPath)).toBe(true);
  });

  it("buildProjectSkillsPromptBlock injects fact/heuristic summary", async () => {
    const root = await makeProject();
    const block = await buildProjectSkillsPromptBlock(root);
    expect(block).toContain("项目 Skills");
    expect(block).toContain("[heuristic]");
  });

  it("upsertProjectSkill writes and updates index", async () => {
    const root = await makeProject();
    await ensureDefaultProjectSkills(root);
    const result = await upsertProjectSkill(
      root,
      "feature-flag",
      { kind: "fact", title: "特性开关位置" },
      "开关定义在 `src/config/flags.ts`。",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const read = await readProjectSkill(root, "feature-flag");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.body).toContain("flags.ts");
  });

  it("archiveExplorationNote writes exploration snapshot", async () => {
    const root = await makeProject();
    await ensureDefaultProjectSkills(root);
    const result = await archiveExplorationNote(root, "2026-test.md", "# snap\n", {
      readCount: 3,
      writtenCount: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path).toContain(".aiall/exploration/");
  });
});
