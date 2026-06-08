import { describe, expect, it } from "vitest";
import { buildImageRefsForMessage } from "./vibeChatImageStore";

describe("vibeChatImageStore", () => {
  it("buildImageRefsForMessage uses stable session/message paths", () => {
    const refs = buildImageRefsForMessage("sess-1", "msg-1", ["data:image/png;base64,abc"]);
    expect(refs).toEqual([{ path: "images/sess-1/msg-1-0.png" }]);
  });
});
