import { Octokit } from "octokit";
import pino, { type Logger } from "pino";
import type { Issue, PullRequest, CheckRun, ReviewComment, PRWithReviewFeedback } from "./types.js";

export class GitHubClient {
  private octokit: Octokit;
  private logger: Logger;

  constructor(token: string, logger?: Logger) {
    this.octokit = new Octokit({ auth: token });
    this.logger = (logger ?? pino({ level: "silent" })).child({ module: "github" });
  }

  issueKey(owner: string, repo: string, number: number): string {
    return `${owner}/${repo}#${number}`;
  }

  parseIssueKey(key: string): { owner: string; repo: string; number: number } | null {
    const match = key.match(/^(.+)\/(.+)#(\d+)$/);
    if (!match) return null;
    return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
  }

  async fetchIssues(owner: string, repo: string, labels: string | string[]): Promise<Issue[]> {
    const labelList = Array.isArray(labels) ? labels : [labels];

    const [issueResults, { data: prs }] = await Promise.all([
      Promise.all(
        labelList.map((label) =>
          this.octokit.rest.issues.listForRepo({
            owner, repo, labels: label, state: "open", per_page: 100,
          }),
        ),
      ),
      this.octokit.rest.pulls.list({
        owner, repo, state: "open", per_page: 100,
      }),
    ]);

    // Merge and deduplicate issues from all label queries
    const seen = new Set<number>();
    const data: typeof issueResults[0]["data"] = [];
    for (const result of issueResults) {
      for (const issue of result.data) {
        if (!seen.has(issue.number)) {
          seen.add(issue.number);
          data.push(issue);
        }
      }
    }

    this.logger.debug({ owner, repo, labels: labelList, issueCount: data.length, prCount: prs.length }, "fetched issues and PRs");

    const linkedIssues = new Set<number>();
    for (const pr of prs) {
      for (const num of this.extractLinkedIssueNumbers(pr.body)) {
        linkedIssues.add(num);
      }
    }

    return data
      .filter((i) => !i.pull_request)
      .map((i) => ({
        key: this.issueKey(owner, repo, i.number),
        owner, repo,
        number: i.number,
        title: i.title,
        body: i.body ?? "",
        labels: i.labels.map((l) => (typeof l === "string" ? l : l.name ?? "")),
        state: i.state,
        hasOpenPR: linkedIssues.has(i.number),
      }));
  }

  async addLabel(owner: string, repo: string, number: number, label: string): Promise<void> {
    await this.octokit.rest.issues.addLabels({ owner, repo, issue_number: number, labels: [label] });
    this.logger.debug({ owner, repo, number, label }, "added label");
  }

  async removeLabel(owner: string, repo: string, number: number, label: string): Promise<void> {
    try {
      await this.octokit.rest.issues.removeLabel({ owner, repo, issue_number: number, name: label });
      this.logger.debug({ owner, repo, number, label }, "removed label");
    } catch {
      this.logger.debug({ owner, repo, number, label }, "label not present, skipping removal");
    }
  }

  async fetchPRsWithLabel(owner: string, repo: string, label: string): Promise<PullRequest[]> {
    const { data } = await this.octokit.rest.pulls.list({ owner, repo, state: "open", per_page: 100 });
    this.logger.debug({ owner, repo, label, count: data.length }, "fetched PRs");
    return data
      .filter((pr) => pr.labels.some((l) => l.name === label))
      .map((pr) => ({
        key: this.issueKey(owner, repo, pr.number),
        owner, repo,
        number: pr.number,
        title: pr.title,
        headRef: pr.head.ref,
        state: pr.state,
        labels: pr.labels.map((l) => l.name ?? ""),
      }));
  }

  private extractLinkedIssueNumbers(body: string | null | undefined): Set<number> {
    if (!body) return new Set();
    const pattern = /(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\s+#(\d+)/gi;
    const numbers = new Set<number>();
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      numbers.add(parseInt(match[1], 10));
    }
    return numbers;
  }

  async fetchPRReviewComments(owner: string, repo: string, prNumber: number): Promise<ReviewComment[]> {
    const { data } = await this.octokit.rest.pulls.listReviewComments({
      owner, repo, pull_number: prNumber, per_page: 100, sort: "created", direction: "desc",
    });
    this.logger.debug({ owner, repo, prNumber, count: data.length }, "fetched PR review comments");
    return data.map((c) => ({
      id: c.id,
      body: c.body,
      path: c.path,
      user: c.user?.login ?? "unknown",
      createdAt: c.created_at,
      pullRequestReviewId: c.pull_request_review_id,
    }));
  }

  async fetchPRsWithReviewFeedback(
    owner: string,
    repo: string,
    label: string,
    lastProcessedCommentIds: Map<string, number>,
  ): Promise<PRWithReviewFeedback[]> {
    const prs = await this.fetchPRsWithLabel(owner, repo, label);
    const results: PRWithReviewFeedback[] = [];

    for (const pr of prs) {
      const comments = await this.fetchPRReviewComments(owner, repo, pr.number);
      if (comments.length === 0) continue;

      const latestCommentId = Math.max(...comments.map((c) => c.id));
      const lastProcessed = lastProcessedCommentIds.get(pr.key) ?? 0;

      if (latestCommentId > lastProcessed) {
        // Only include comments newer than the last processed one
        const newComments = comments.filter((c) => c.id > lastProcessed);
        if (newComments.length > 0) {
          results.push({ pr, comments: newComments, latestCommentId });
        }
      }
    }

    this.logger.debug({ owner, repo, label, prsWithFeedback: results.length }, "fetched PRs with review feedback");
    return results;
  }

  async fetchPRDiff(owner: string, repo: string, prNumber: number): Promise<string> {
    const { data } = await this.octokit.rest.pulls.get({
      owner, repo, pull_number: prNumber,
      mediaType: { format: "diff" },
    });
    this.logger.debug({ owner, repo, prNumber }, "fetched PR diff");
    return data as unknown as string;
  }

  async findMergedPRForIssue(owner: string, repo: string, issueNumber: number): Promise<{ number: number } | null> {
    const { data: prs } = await this.octokit.rest.pulls.list({
      owner, repo, state: "closed", per_page: 100, sort: "updated", direction: "desc",
    });

    for (const pr of prs) {
      if (!pr.merged_at) continue;
      const linked = this.extractLinkedIssueNumbers(pr.body);
      if (linked.has(issueNumber)) {
        this.logger.debug({ owner, repo, issueNumber, prNumber: pr.number }, "found merged PR for issue");
        return { number: pr.number };
      }
    }

    return null;
  }

  async addComment(owner: string, repo: string, issueNumber: number, body: string): Promise<void> {
    await this.octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body });
    this.logger.debug({ owner, repo, issueNumber }, "added comment to issue");
  }

  /**
   * Parse dependency markers from an issue body.
   * Supports "Depends on #N", "Blocked by #N", "Requires #N" (case-insensitive).
   */
  parseDependencies(body: string | null | undefined): number[] {
    if (!body) return [];
    const pattern = /(?:depends\s+on|blocked\s+by|requires)\s+#(\d+)/gi;
    const numbers: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      const num = parseInt(match[1], 10);
      if (!numbers.includes(num)) {
        numbers.push(num);
      }
    }
    return numbers;
  }

  /**
   * Check if a specific issue is closed.
   */
  async isIssueClosed(owner: string, repo: string, number: number): Promise<boolean> {
    const { data } = await this.octokit.rest.issues.get({ owner, repo, issue_number: number });
    return data.state === "closed";
  }

  async fetchPRMergeableStatus(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<{ mergeable: boolean | null; mergeableState: string }> {
    const { data } = await this.octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
    return {
      mergeable: data.mergeable ?? null,
      mergeableState: data.mergeable_state ?? "unknown",
    };
  }

  async fetchOpenPRs(owner: string, repo: string): Promise<PullRequest[]> {
    const { data } = await this.octokit.rest.pulls.list({ owner, repo, state: "open", per_page: 100 });
    this.logger.debug({ owner, repo, count: data.length }, "fetched open PRs");
    return data.map((pr) => ({
      key: this.issueKey(owner, repo, pr.number),
      owner,
      repo,
      number: pr.number,
      title: pr.title,
      headRef: pr.head.ref,
      state: pr.state,
      labels: pr.labels.map((l) => l.name ?? ""),
    }));
  }

  async fetchCheckRuns(owner: string, repo: string, ref: string): Promise<CheckRun[]> {
    const { data } = await this.octokit.rest.checks.listForRef({ owner, repo, ref });
    this.logger.debug({ owner, repo, ref, count: data.check_runs.length }, "fetched check runs");
    return data.check_runs.map((cr) => ({
      id: cr.id,
      name: cr.name,
      status: cr.status,
      conclusion: cr.conclusion,
    }));
  }

  async submitPRReview(
    owner: string,
    repo: string,
    prNumber: number,
    event: "APPROVE" | "REQUEST_CHANGES",
    body: string,
    comments?: Array<{ path: string; line: number; body: string }>,
  ): Promise<void> {
    await this.octokit.rest.pulls.createReview({
      owner, repo, pull_number: prNumber, event, body, comments,
    });
    this.logger.debug({ owner, repo, prNumber, event }, "submitted PR review");
  }

  async mergePR(
    owner: string,
    repo: string,
    prNumber: number,
    mergeMethod: "squash" | "merge" | "rebase" = "squash",
  ): Promise<void> {
    await this.octokit.rest.pulls.merge({
      owner, repo, pull_number: prNumber, merge_method: mergeMethod,
    });
    this.logger.debug({ owner, repo, prNumber, mergeMethod }, "merged PR");
  }

  async fetchPRReviews(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<Array<{ id: number; state: string; user: string }>> {
    const { data } = await this.octokit.rest.pulls.listReviews({
      owner,
      repo,
      pull_number: prNumber,
    });
    this.logger.debug({ owner, repo, prNumber, count: data.length }, "fetched PR reviews");
    return data
      .sort((a, b) => new Date(b.submitted_at ?? 0).getTime() - new Date(a.submitted_at ?? 0).getTime())
      .map((r) => ({
        id: r.id,
        state: r.state,
        user: r.user?.login ?? "unknown",
      }));
  }

  async allChecksPassed(owner: string, repo: string, ref: string): Promise<boolean> {
    const checks = await this.fetchCheckRuns(owner, repo, ref);
    return checks.every((c) => c.status === "completed" && c.conclusion === "success");
  }
}
