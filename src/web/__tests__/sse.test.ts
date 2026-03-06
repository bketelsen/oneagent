import { describe, it, expect, vi } from "vitest";
import { SSEHub } from "../sse.js";

describe("SSEHub", () => {
  it("broadcasts events to subscribers", () => {
    const hub = new SSEHub();
    const listener = vi.fn();
    hub.subscribe(listener);
    hub.broadcast("agent:started", { runId: "r1" });
    expect(listener).toHaveBeenCalledWith("agent:started", { runId: "r1" });
  });

  it("removes unsubscribed listeners", () => {
    const hub = new SSEHub();
    const listener = vi.fn();
    const unsub = hub.subscribe(listener);
    unsub();
    hub.broadcast("agent:started", { runId: "r1" });
    expect(listener).not.toHaveBeenCalled();
  });
});
