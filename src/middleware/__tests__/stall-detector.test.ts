import { describe, it, expect, vi } from "vitest";
import { createStallDetector } from "../stall-detector.js";

describe("createStallDetector", () => {
  it("calls onStall when no chunks arrive within timeout", async () => {
    const onStall = vi.fn();
    const detector = createStallDetector(50, onStall);
    detector.start();
    await new Promise((r) => setTimeout(r, 100));
    expect(onStall).toHaveBeenCalled();
    detector.stop();
  });

  it("resets timer on activity", async () => {
    const onStall = vi.fn();
    const detector = createStallDetector(100, onStall);
    detector.start();
    await new Promise((r) => setTimeout(r, 50));
    detector.activity();
    await new Promise((r) => setTimeout(r, 50));
    detector.activity();
    expect(onStall).not.toHaveBeenCalled();
    detector.stop();
  });
});
