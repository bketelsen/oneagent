import { defineTool } from "one-agent-sdk";
import { z } from "zod";

export interface ReviewVerdict {
  verdict: "approve" | "request_changes";
  summary: string;
  comments?: Array<{ path: string; line: number; body: string }>;
}

export function createReviewTools() {
  let captured: ReviewVerdict | null = null;

  const submitReview = defineTool({
    name: "submit_review",
    description:
      "Submit your review verdict. Use 'approve' if the code is correct, secure, and well-tested. Use 'request_changes' if there are issues, with specific inline comments.",
    parameters: z.object({
      verdict: z.enum(["approve", "request_changes"]),
      summary: z.string().describe("Overall review summary"),
      comments: z
        .array(
          z.object({
            path: z.string().describe("File path relative to repo root"),
            line: z.number().describe("Line number"),
            body: z.string().describe("Comment explaining the issue and how to fix it"),
          }),
        )
        .optional()
        .describe("Inline comments for request_changes"),
    }),
    handler: async (params) => {
      captured = {
        verdict: params.verdict,
        summary: params.summary,
        comments: params.comments,
      };
      return `Review verdict recorded: ${params.verdict}`;
    },
  });

  const getVerdict = (): ReviewVerdict | null => captured;

  return { submitReview, getVerdict };
}
