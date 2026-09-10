import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  ExecutionProviderStatus,
  GitBranchEntry,
  GitLogEntry,
  GitProvider,
  GitPushResult,
  GitStatus,
} from "@/server/cloud/types";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { workerConfigured, workerPost } from "@/server/cloud/workerClient";

const execFileAsync = promisify(execFile);

const BRANCH_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,100}$/;

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Local git provider. Uses `git` with an explicit argv (never a shell), pauses
 * paging, and — critically — refuses to ever force, hard-reset, clean, rebase,
 * or otherwise rewrite history. Every mutation is audited by the caller.
 */

async function runGit(root: string, args: string[], timeoutMs = 30_000): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", ["--no-pager", "-c", "core.quotepath=false", ...args], {
      cwd: root,
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return { code: 0, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
    return { code: e.code ?? 1, stdout: (e.stdout ?? "").trim(), stderr: (e.stderr ?? e.message ?? "").trim() };
  }
}

function parseStatus(stdout: string): GitStatus {
  const lines = stdout.split("\n").filter((line) => line.length > 0);
  const status: GitStatus = { branch: "main", ahead: 0, behind: 0, clean: true, files: [] };
  for (const line of lines) {
    if (line.startsWith("## ")) {
      const rest = line.slice(3);
      status.branch = rest.split("...")[0] ?? rest;
      const ahead = rest.match(/ahead (\d+)/);
      const behind = rest.match(/behind (\d+)/);
      status.ahead = ahead ? Number(ahead[1]) : 0;
      status.behind = behind ? Number(behind[1]) : 0;
      continue;
    }
    status.clean = false;
    status.files.push({ x: line[0] ?? " ", y: line[1] ?? " ", path: line.slice(3) });
  }
  return status;
}

export class LocalGitProvider implements GitProvider {
  readonly id = "local-git";

  providerStatus(): ExecutionProviderStatus {
    return {
      configured: true,
      id: this.id,
      label: "Local git provider",
      description: "Safe git operations on the workspace repository.",
    };
  }

  async isGitRepo(root: string): Promise<boolean> {
    const res = await runGit(root, ["rev-parse", "--is-inside-work-tree"]);
    return res.code === 0 && res.stdout === "true";
  }

  async status(root: string): Promise<GitStatus> {
    if (!(await this.isGitRepo(root))) {
      throw new ValidationError("This project is not a git repository yet. Initialize one to use git operations.");
    }
    const res = await runGit(root, ["status", "--porcelain=v1", "-b"]);
    return parseStatus(res.stdout);
  }

  async init(root: string, defaultBranch = "main"): Promise<GitStatus> {
    assertBranchName(defaultBranch);
    const res = await runGit(root, ["init", "-b", defaultBranch]);
    if (res.code !== 0) {
      throw new ValidationError(res.stderr || "Could not initialize the repository.");
    }
    return parseStatus((await runGit(root, ["status", "--porcelain=v1", "-b"])).stdout);
  }

  private async ensureGitIdentity(root: string): Promise<void> {
    const name = await runGit(root, ["config", "--get", "user.name"]);
    if (name.code !== 0) {
      await runGit(root, ["config", "user.name", "Chatr Cloud Dev"]);
      await runGit(root, ["config", "user.email", "cloud-dev@chatr.local"]);
    }
  }

  async diff(root: string, filePath?: string): Promise<string> {
    const res = filePath
      ? await runGit(root, ["diff", "--", filePath])
      : await runGit(root, ["diff"]);
    if (res.code !== 0) throw new ValidationError(res.stderr || "git diff failed.");
    return res.stdout;
  }

  async log(root: string, count = 20): Promise<GitLogEntry[]> {
    const res = await runGit(root, [
      "log",
      `-n ${count}`,
      "--pretty=format:%h|%H|%an|%ad|%s",
      "--date=short",
    ]);
    if (res.code !== 0) return [];
    return res.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [short, ref, author, date, ...subjectParts] = line.split("|");
        return { short: short ?? "", ref: ref ?? "", author: author ?? "", date: date ?? "", subject: subjectParts.join("|") };
      });
  }

  async branches(root: string): Promise<GitBranchEntry[]> {
    const current = await this.currentBranch(root);
    const res = await runGit(root, ["branch", "--format=%(refname:short)"]);
    if (res.code !== 0) return [];
    return res.stdout
      .split("\n")
      .filter(Boolean)
      .map((name) => ({ name, current: current.branch === name }));
  }

  async currentBranch(root: string): Promise<{ branch: string; head: string }> {
    const branchRes = await runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const headRes = await runGit(root, ["rev-parse", "HEAD"]);
    if (branchRes.code !== 0 || headRes.code !== 0) {
      throw new ValidationError("Could not resolve the current branch.");
    }
    return { branch: branchRes.stdout, head: headRes.stdout };
  }

  async createBranch(root: string, name: string): Promise<GitStatus> {
    assertBranchName(name);
    const current = await this.status(root);
    if (!current.clean) {
      throw new ForbiddenError("Working tree is not clean. Commit or revert the changes first.");
    }
    const res = await runGit(root, ["checkout", "-b", name]);
    if (res.code !== 0) throw new ValidationError(res.stderr || "Could not create branch.");
    return this.status(root);
  }

  async checkout(root: string, ref: string): Promise<GitStatus> {
    assertBranchName(ref);
    const current = await this.status(root);
    if (!current.clean) {
      throw new ForbiddenError("Working tree is not clean. Commit or revert the changes first.");
    }
    const res = await runGit(root, ["checkout", ref]);
    if (res.code !== 0) throw new ValidationError(res.stderr || "Could not switch branch.");
    return this.status(root);
  }

  async commit(root: string, message: string): Promise<{ ref: string; message: string }> {
    const cleanMessage = message.replace(/[\r\n]+/g, " ").trim();
    if (!cleanMessage || cleanMessage.length > 2000) {
      throw new ValidationError("A commit message is required (max 2000 characters).");
    }
    await this.ensureGitIdentity(root);
    const res = await runGit(root, ["commit", "-m", cleanMessage]);
    if (res.code !== 0) throw new ValidationError(res.stderr || "Commit failed.");
    const { head } = await this.currentBranch(root);
    return { ref: head, message: cleanMessage };
  }

  async stageAll(root: string): Promise<void> {
    const res = await runGit(root, ["add", "-A"]);
    if (res.code !== 0) throw new ValidationError(res.stderr || "Could not stage changes.");
  }

  async pull(root: string): Promise<{ ok: boolean; message: string }> {
    const res = await runGit(root, ["pull", "--ff-only"]);
    if (res.code !== 0) {
      return {
        ok: false,
        message: res.stderr.includes("No refs")
          ? "No remote tracking branch is configured for this branch."
          : res.stderr || "Pull failed. Nothing was changed.",
      };
    }
    return { ok: true, message: res.stdout || "Up to date." };
  }

  async push(root: string): Promise<GitPushResult> {
    const res = await runGit(root, ["push"]);
    if (res.code !== 0) {
      return {
        ok: false,
        message:
          res.stderr.includes("has no upstream branch") ||
          res.stderr.includes("No configured push destination")
            ? "No upstream branch is configured. Create/checkout a branch with an upstream first."
            : res.stderr || "Push failed.",
      };
    }
    return { ok: true, message: res.stdout || "Pushed." };
  }
}

const WORKER_GIT_TIMEOUT_MS = 60_000;

/**
 * Remote git provider. The "root" is the project-id handle; every operation
 * runs on the worker's own volume endpoint, which mirrors the LocalGitProvider
 * safeties (fixed argv, no history rewrite, dirty-tree guards, bounded output).
 */
export class RemoteGitProvider implements GitProvider {
  readonly id = "remote-git";

  providerStatus(): ExecutionProviderStatus {
    if (!workerConfigured()) {
      return {
        configured: false,
        id: this.id,
        label: "Remote git provider",
        description: "Safe git operations on the workspace repository (worker volume).",
        reason: "CLOUD_EXECUTION_WORKER_URL/TOKEN are not configured.",
      };
    }
    return {
      configured: true,
      id: this.id,
      label: "Remote git provider",
      description: "Safe git operations on the workspace repository (worker volume).",
    };
  }

  private async post<T>(root: string, path: string, body: unknown): Promise<T> {
    return workerPost<T>(`/workspaces/${root}${path}`, body, {
      timeoutMs: WORKER_GIT_TIMEOUT_MS,
      label: "git operation",
    });
  }

  async isGitRepo(root: string): Promise<boolean> {
    const { ok } = await this.post<{ ok: boolean }>(root, "/git-is-repo", {});
    return ok;
  }

  async status(root: string): Promise<GitStatus> {
    const { status } = await this.post<{ status: GitStatus }>(root, "/git-status", {});
    return status;
  }

  async diff(root: string, path?: string): Promise<string> {
    const { diff } = await this.post<{ diff: string }>(root, "/git-diff", { path });
    return diff;
  }

  async log(root: string, count = 20): Promise<GitLogEntry[]> {
    const { log } = await this.post<{ log: GitLogEntry[] }>(root, "/git-log", { count });
    return log;
  }

  async branches(root: string): Promise<GitBranchEntry[]> {
    const { branches } = await this.post<{ branches: GitBranchEntry[] }>(root, "/git-branches", {});
    return branches;
  }

  async currentBranch(root: string): Promise<{ branch: string; head: string }> {
    return this.post<{ branch: string; head: string }>(root, "/git-current-branch", {});
  }

  async init(root: string, defaultBranch = "main"): Promise<GitStatus> {
    const { status } = await this.post<{ status: GitStatus }>(root, "/git-init", { defaultBranch });
    return status;
  }

  async createBranch(root: string, name: string): Promise<GitStatus> {
    const { status } = await this.post<{ status: GitStatus }>(root, "/git-create-branch", { name });
    return status;
  }

  async checkout(root: string, ref: string): Promise<GitStatus> {
    const { status } = await this.post<{ status: GitStatus }>(root, "/git-checkout", { ref });
    return status;
  }

  async commit(root: string, message: string): Promise<{ ref: string; message: string }> {
    return this.post<{ ref: string; message: string }>(root, "/git-commit", { message });
  }

  async stageAll(root: string): Promise<void> {
    await this.post<{ ok: boolean }>(root, "/git-stage-all", {});
  }

  async pull(root: string): Promise<{ ok: boolean; message: string }> {
    return this.post<{ ok: boolean; message: string }>(root, "/git-pull", {});
  }

  async push(root: string): Promise<GitPushResult> {
    return this.post<GitPushResult>(root, "/git-push", {});
  }
}

function assertBranchName(name: string): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new ValidationError("A branch name is required.");
  }
  if (name.startsWith("-") || !BRANCH_NAME_PATTERN.test(name)) {
    throw new ForbiddenError("Branch name is not allowed.");
  }
}

let cachedGit: GitProvider | null = null;

/** True when a worker URL and token are configured (git offloaded to the worker). */
export function remoteGitConfigured(): boolean {
  return workerConfigured();
}

/** Returns the shared git provider (remote when a worker URL is set). */
export function getGitProvider(): GitProvider {
  if (!cachedGit) {
    cachedGit = process.env.CLOUD_EXECUTION_WORKER_URL
      ? new RemoteGitProvider()
      : new LocalGitProvider();
  }
  return cachedGit;
}

/** Re-exported for callers that need repo checks. */
export { assertBranchName };