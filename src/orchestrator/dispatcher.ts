import type { Issue, PullRequest, ReviewComment } from "../github/types.js";

export class Dispatcher {
  buildPrompt(issue: Issue, workDir?: string): string {
    const workDirLine = workDir ? `\n**Workspace:** ${workDir}` : "";
    return `## GitHub Issue: ${issue.key}

**Title:** ${issue.title}

**Description:**
${issue.body}

**Repository:** ${issue.owner}/${issue.repo}
**Issue Number:** #${issue.number}
**Labels:** ${issue.labels.join(", ")}${workDirLine}

Work on this issue. Read the codebase, understand the requirements, implement the solution, write tests, and prepare for a pull request.`;
  }

  buildPRFixPrompt(pr: PullRequest, failureLogs: string): string {
    return `## CI Failure Fix: ${pr.key}

**PR Title:** ${pr.title}
**Branch:** ${pr.headRef}
**Repository:** ${pr.owner}/${pr.repo}

**CI Failure Logs:**
\`\`\`
${failureLogs}
\`\`\`

Analyze the CI failure, fix the issue on branch \`${pr.headRef}\`, and push the fix.`;
  }

  buildPRReviewPrompt(pr: PullRequest, comments: ReviewComment[], diff: string, workDir?: string): string {
    const workDirLine = workDir ? `\n**Workspace:** ${workDir}` : "";
    const commentBlock = comments
      .map((c) => `- **${c.user}** on \`${c.path}\`:\n  ${c.body}`)
      .join("\n\n");

    return `## PR Review Feedback: ${pr.key}

**PR Title:** ${pr.title}
**Branch:** ${pr.headRef}
**Repository:** ${pr.owner}/${pr.repo}${workDirLine}

**Review Comments:**
${commentBlock}

**Current Diff:**
\`\`\`diff
${diff}
\`\`\`

Address the review feedback above. Make the requested changes on branch \`${pr.headRef}\` and push the fixes. Do NOT create a new PR — push to the existing branch.`;
  }

  buildReviewDispatchPrompt(pr: PullRequest, diff: string): string {
    return `## PR Review: ${pr.key}

**PR Title:** ${pr.title}
**Branch:** ${pr.headRef}
**Repository:** ${pr.owner}/${pr.repo}
**PR Number:** #${pr.number}

**Diff to review:**
\`\`\`diff
${diff}
\`\`\`

Review this pull request. After your review:
- If the code is correct, secure, and well-tested: submit an APPROVE review
- If changes are needed: submit a REQUEST_CHANGES review with specific inline comments

Use the GitHub API to submit your review on PR #${pr.number} in ${pr.owner}/${pr.repo}.`;
  }
}
