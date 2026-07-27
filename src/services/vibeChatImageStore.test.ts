import { describe, expect, it } from "vitest";
import {
  applySyncedImageRefs,
  buildImageRefsForMessage,
  resolveChatMessageImageUrls,
} from "./vibeChatImageStore";

describe("vibeChatImageStore", () => {
  it("buildImageRefsForMessage uses stable session/message paths", () => {
    const refs = buildImageRefsForMessage("sess-1", "msg-1", ["data:image/png;base64,abc"]);
    expect(refs).toEqual([{ path: "images/sess-1/msg-1-0.png" }]);
  });

  it("resolveChatMessageImageUrls prefers inline data URLs", () => {
    expect(
      resolveChatMessageImageUrls("D:/p", {
        imageDataUrls: ["data:image/png;base64,abc"],
        imageRefs: [{ path: "images/s/u1-0.png" }],
      }),
    ).toEqual(["data:image/png;base64,abc"]);
  });

  it("resolveChatMessageImageUrls falls back to backend file URLs", () => {
    const urls = resolveChatMessageImageUrls("D:/project/AIALL", {
      imageRefs: [{ path: "images/s/u1-0.png" }],
    });
    expect(urls[0]).toContain("/backend/vibe/chat-image-file?");
    expect(urls[0]).toContain("images%2Fs%2Fu1-0.png");
  });

  it("resolveChatMessageImageUrls reconstructs paths from imageCount", () => {
    const urls = resolveChatMessageImageUrls(
      "D:/project/AIALL",
      { id: "msg-1", imageCount: 1 },
      "sess-1",
    );
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("images%2Fsess-1%2Fmsg-1-0.png");
  });

  it("applySyncedImageRefs prefers verified server refs", () => {
    const messages = [
      {
        id: "msg-1",
        role: "user" as const,
        content: "附图",
        imageDataUrls: ["data:image/jpeg;base64,QQ=="],
      },
    ];
    const stamped = applySyncedImageRefs(messages, {
      "msg-1": [{ path: "images/sess/msg-1-0.jpg" }],
    });
    expect(stamped[0].imageRefs).toEqual([{ path: "images/sess/msg-1-0.jpg" }]);
    expect(stamped[0].imageCount).toBe(1);
    expect(stamped[0].imageDataUrls).toHaveLength(1);
  });
});
