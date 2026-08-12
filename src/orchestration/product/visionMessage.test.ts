import { describe, expect, it } from "vitest";
import { isSpeculativeCodeMechanismAnswer } from "./visionMessage";

describe("isSpeculativeCodeMechanismAnswer", () => {
  it("flags answers asserting code mechanisms without read evidence", () => {
    expect(
      isSpeculativeCodeMechanismAnswer(
        "`.git-remote-actions` 设有 `margin-left: auto`，窄面板下按钮组不肯缩小。",
      ),
    ).toBe(true);
    expect(
      isSpeculativeCodeMechanismAnswer(
        "`flex: 1` 导致按钮宽度不均，每个按钮均分空间。",
      ),
    ).toBe(true);
    expect(
      isSpeculativeCodeMechanismAnswer(
        "模板里应写成 `{{ ahead }}`，事件用 `$emit('fetch')`。",
      ),
    ).toBe(true);
  });

  it("does not flag plain visual observations from the screenshot", () => {
    expect(isSpeculativeCodeMechanismAnswer("从截图看，右侧按钮被蓝色区域遮挡，视觉上偏挤。")).toBe(false);
    expect(isSpeculativeCodeMechanismAnswer("分支名显示为 m…，被截断了。")).toBe(false);
  });

  it("flags mechanism assertions regardless of cited files — read-evidence gating is the caller's job", () => {
    // A backtick class selector is a mechanism claim even inside a read-evidence answer;
    // whether the file was actually read is decided by consultativeNeedsGrepHitVueRead.
    expect(
      isSpeculativeCodeMechanismAnswer(
        "已 read GitPanel.scss：`.git-remote-actions { display: flex; border-radius: 6px; overflow: hidden; }`，无 margin-left。",
      ),
    ).toBe(true);
    // Pure CSS property evidence (background/opacity) is style-level, not a mechanism claim.
    expect(
      isSpeculativeCodeMechanismAnswer(
        "GitPanel.scss 中 background: rgba(255, 255, 255, 0.03)；opacity 未设置。",
      ),
    ).toBe(false);
  });
});
