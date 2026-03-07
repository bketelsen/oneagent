import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureRepoContext } from "./capture-repo-context.js";

export async function cloneAndCapture(
  owner: string,
  repo: string,
  token?: string,
): Promise<string> {
  const url = token
    ? `https://x-access-token:${token}@github.com/${owner}/${repo}.git`
    : `https://github.com/${owner}/${repo}.git`;

  const tmpDir = mkdtempSync(join(tmpdir(), "oneagent-plan-"));
  try {
    execFileSync("git", ["clone", "--depth", "1", "--single-branch", url, tmpDir], {
      encoding: "utf-8",
      timeout: 60000,
      stdio: "pipe",
    });
    return captureRepoContext(tmpDir);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
