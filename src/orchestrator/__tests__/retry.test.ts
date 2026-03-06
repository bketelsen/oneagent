import { describe, it, expect } from "vitest";
import { RetryQueue } from "../retry.js";

describe("RetryQueue", () => {
  it("queues items with exponential backoff", () => {
    const q = new RetryQueue(1000, 3);
    q.enqueue("o/r#1", 0);
    expect(q.size()).toBe(1);
  });

  it("returns due items", () => {
    const q = new RetryQueue(0, 3);
    q.enqueue("o/r#1", 0);
    const due = q.due();
    expect(due).toContain("o/r#1");
  });

  it("does not return items not yet due", () => {
    const q = new RetryQueue(999999, 3);
    q.enqueue("o/r#1", 0);
    const due = q.due();
    expect(due).toHaveLength(0);
  });

  it("returns false for exhausted retries", () => {
    const q = new RetryQueue(1000, 3);
    expect(q.canRetry(3)).toBe(false);
    expect(q.canRetry(2)).toBe(true);
  });

  it("removes items when dequeued", () => {
    const q = new RetryQueue(0, 3);
    q.enqueue("o/r#1", 0);
    q.dequeue("o/r#1");
    expect(q.size()).toBe(0);
  });
});
