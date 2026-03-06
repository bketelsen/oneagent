import { Octokit } from "octokit";
import type { Issue, PullRequest, CheckRun } from "./types.js";

export class GitHubClient {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  issueKey(owner: string, repo: string, number: number): string {
    return `${owner}/${repo}#${number}`;
  }

  parseIssueKey(key: string): { owner: string; repo: string; number: number } | null {
    const match = key.match(/^(.+)\/(.+)#(\d+)$/);
    if (!match) return null;
    return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
  }

  async fetchIssues(owner: string, repo: string, label: string): Promise<Issue[]> {
    const { data } = await this.octokit.rest.issues.listForRepo({
      owner, repo, labels: label, state: "open", per_page: 100,
    });
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
        hasOpenPR: false,
      }));
  }

  async addLabel(owner: string, repo: string, number: number, label: string): Promise<void> {
    await this.octokit.rest.issues.addLabels({ owner, repo, issue_number: number, labels: [label] });
  }

  async removeLabel(owner: string, repo: string, number: number, label: string): Promise<void> {
    try {
      await this.octokit.rest.issues.removeLabel({ owner, repo, issue_number: number, name: label });
    } catch { /* label may not exist */ }
  }

  async fetchPRsWithLabel(owner: string, repo: string, label: string): Promise<PullRequest[]> {
    const { data } = await this.octokit.rest.pulls.list({ owner, repo, state: "open", per_page: 100 });
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

  async fetchCheckRuns(owner: string, repo: string, ref: string): Promise<CheckRun[]> {
    const { data } = await this.octokit.rest.checks.listForRef({ owner, repo, ref });
    return data.check_runs.map((cr) => ({
      id: cr.id,
      name: cr.name,
      status: cr.status,
      conclusion: cr.conclusion,
    }));
  }
}
