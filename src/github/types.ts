export interface Issue {
  key: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: string;
  hasOpenPR: boolean;
}

export interface PullRequest {
  key: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  headRef: string;
  state: string;
  labels: string[];
}

export interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
}

export interface ReviewComment {
  id: number;
  body: string;
  path?: string;
  user: string;
  createdAt: string;
  pullRequestReviewId: number | null;
}

export interface PRWithReviewFeedback {
  pr: PullRequest;
  comments: ReviewComment[];
  latestCommentId: number;
}
