import { describe, it, expect } from "vitest";
import { createReviewTools } from "../review.js";

describe("review tools", () => {
  it("submit_review captures approve verdict", async () => {
    const { submitReview, getVerdict } = createReviewTools();

    const result = await submitReview.handler({
      verdict: "approve",
      summary: "LGTM, clean implementation",
    });

    expect(result).toContain("recorded");
    const verdict = getVerdict();
    expect(verdict).toEqual({
      verdict: "approve",
      summary: "LGTM, clean implementation",
      comments: undefined,
    });
  });

  it("submit_review captures request_changes verdict with comments", async () => {
    const { submitReview, getVerdict } = createReviewTools();

    await submitReview.handler({
      verdict: "request_changes",
      summary: "Found issues",
      comments: [
        { path: "src/foo.ts", line: 10, body: "Missing null check" },
      ],
    });

    const verdict = getVerdict();
    expect(verdict).toEqual({
      verdict: "request_changes",
      summary: "Found issues",
      comments: [{ path: "src/foo.ts", line: 10, body: "Missing null check" }],
    });
  });

  it("getVerdict returns null before tool is called", () => {
    const { getVerdict } = createReviewTools();
    expect(getVerdict()).toBeNull();
  });
});
