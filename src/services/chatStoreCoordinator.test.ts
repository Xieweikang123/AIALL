import { describe, expect, it } from "vitest";
import { enqueueChatStoreOp } from "./chatStoreCoordinator";

describe("chatStoreCoordinator", () => {
  it("runs nested enqueue inline without deadlocking", async () => {
    const order: number[] = [];
    await enqueueChatStoreOp("D:/projects/nested", async () => {
      order.push(1);
      await enqueueChatStoreOp("D:/projects/nested", async () => {
        order.push(2);
      });
      order.push(3);
    });
    expect(order).toEqual([1, 2, 3]);
  });

  it("serializes separate top-level ops for the same project", async () => {
    const order: number[] = [];
    await Promise.all([
      enqueueChatStoreOp("D:/projects/serial", async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push(1);
      }),
      enqueueChatStoreOp("D:/projects/serial", async () => {
        order.push(2);
      }),
    ]);
    expect(order).toEqual([1, 2]);
  });
});
