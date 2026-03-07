import { describe, it, expect, vi, beforeEach } from "vitest";
import { logHandoff, type HandoffEvent } from "../logging.js";

describe("logHandoff", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs a structured handoff event at info level", () => {
    logHandoff("coder", "tdd", "run-123", 15, mockLogger as any);

    expect(mockLogger.info).toHaveBeenCalledOnce();
    const [payload, message] = mockLogger.info.mock.calls[0];

    expect(message).toBe("agent.handoff");
    expect(payload.event).toBe("agent.handoff");
    expect(payload.from).toBe("coder");
    expect(payload.to).toBe("tdd");
    expect(payload.runId).toBe("run-123");
    expect(payload.issueNumber).toBe(15);
    expect(payload.timestamp).toBeDefined();
  });

  it("includes an ISO-8601 timestamp", () => {
    logHandoff("coder", "debugger", "run-456", 42, mockLogger as any);

    const [payload] = mockLogger.info.mock.calls[0];
    // Verify it parses as a valid date
    const date = new Date(payload.timestamp);
    expect(date.getTime()).not.toBeNaN();
  });

  it("logs handoffs from specialist agents back to coder", () => {
    logHandoff("reviewer", "coder", "run-789", 7, mockLogger as any);

    const [payload] = mockLogger.info.mock.calls[0];
    expect(payload.from).toBe("reviewer");
    expect(payload.to).toBe("coder");
  });

  it("includes all required fields in the payload", () => {
    logHandoff("coder", "planner", "run-abc", 99, mockLogger as any);

    const [payload] = mockLogger.info.mock.calls[0] as [HandoffEvent, string];
    const requiredKeys: (keyof HandoffEvent)[] = ["event", "from", "to", "runId", "issueNumber", "timestamp"];
    for (const key of requiredKeys) {
      expect(payload).toHaveProperty(key);
    }
  });
});
