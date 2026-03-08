import { describe, it, expect } from "vitest";
import { checkCIStatusTool } from "../ci.js";

describe("ci tools", () => {
  it("checkCIStatusTool has correct name", () => {
    expect(checkCIStatusTool.name).toBe("check_ci_status");
  });
});
