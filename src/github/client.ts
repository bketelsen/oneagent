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
}
