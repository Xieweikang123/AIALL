import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  externalizeMessageImages,
  imageRefRelativePath,
  readImageRefAsDataUrl,
  writeImageRef,
} from "./vibeChatImages";

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("vibeChatImages", () => {
  let tmpDir = "";

  afterEach(async () => {
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
      tmpDir = "";
    }
  });

  it("writes and reads image refs under chat session folder", async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibe-chat-img-"));
    const sessionId = "sess-1";
    const ref = await writeImageRef(tmpDir, sessionId, "msg-1", 0, PNG_DATA_URL);
    expect(ref?.path).toBe(imageRefRelativePath(sessionId, "msg-1", 0, "png"));
    const dataUrl = await readImageRefAsDataUrl(tmpDir, ref!.path);
    expect(dataUrl?.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("externalizeMessageImages strips base64 and keeps refs", async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibe-chat-img-"));
    const messages = await externalizeMessageImages(tmpDir, "s1", [
      { id: "u1", role: "user", content: "看", imageDataUrls: [PNG_DATA_URL] },
      { id: "a1", role: "assistant", content: "ok" },
    ]);
    expect(messages[0].imageDataUrls).toBeUndefined();
    expect(messages[0].imageRefs).toHaveLength(1);
    expect(messages[0].imageCount).toBe(1);
    const abs = path.join(tmpDir, messages[0].imageRefs![0].path.split("/").join(path.sep));
    expect(await fs.promises.stat(abs)).toBeTruthy();
  });
});
