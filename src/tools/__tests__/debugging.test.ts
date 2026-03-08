import { describe, it, expect } from "vitest";
import { readLogsTool, inspectErrorTool } from "../debugging.js";

describe("debugging tools", () => {
  it("readLogsTool has correct name", () => {
    expect(readLogsTool.name).toBe("read_logs");
  });

  it("inspectErrorTool has correct name", () => {
    expect(inspectErrorTool.name).toBe("inspect_error");
  });
});
