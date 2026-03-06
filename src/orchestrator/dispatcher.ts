import type { Issue, PullRequest } from "../github/types.js";

export class Dispatcher {
  buildPrompt(issue: Issue): string {
    return `## GitHub Issue: ${issue.key}

**Title:** ${issue.title}

**Description:**
${issue.body}

**Repository:** ${issue.owner}/${issue.repo}
**Issue Number:** #${issue.number}
**Labels:** ${issue.labels.join(", ")}

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
}
