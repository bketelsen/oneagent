import { describe, it, expect } from "vitest";
import { checkCIStatusTool } from "../ci.js";

describe("checkCIStatusTool", () => {
  it("has the correct tool name", () => {
    expect(checkCIStatusTool.name).toBe("check_ci_status");
  });

  it("accepts valid parameters", () => {
    const result = checkCIStatusTool.parameters.safeParse({
      owner: "bketelsen",
      repo: "oneagent",
      prNumber: 42,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing parameters", () => {
    const result = checkCIStatusTool.parameters.safeParse({
      owner: "bketelsen",
    });
    expect(result.success).toBe(false);
  });
});
