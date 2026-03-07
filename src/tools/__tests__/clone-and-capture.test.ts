import { describe, it, expect } from "vitest";
import { cloneAndCapture } from "../clone-and-capture.js";

// Integration test that actually clones a small public repo
describe("cloneAndCapture", () => {
  it("clones a public repo and returns context", async () => {
    const result = await cloneAndCapture("octocat", "Hello-World");
    expect(result).toContain("## Directory Structure");
    expect(result).toContain("README");
  }, 30000);

  it("throws on non-existent repo", async () => {
    await expect(cloneAndCapture("octocat", "this-repo-does-not-exist-12345"))
      .rejects.toThrow();
  }, 30000);
});
