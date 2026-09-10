import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ForbiddenError,
  ValidationError,
} from "../../src/server/errors";
import type {
  GitBranchEntry,
  GitLogEntry,
  GitPushResult,
  GitStatus,
} from "../../src/server/cloud/types";
import { isSensitivePath } from "../../src/server/cloud/paths";
import { ensureWorkspaceDir } from "./workspaceApi";

/**
 * Git operations for the Cloud Execution worker.
 *
 * Mirrors the safe LocalGitProvider contract but runs on the worker's own
 * volume. Every endpoint maps to a FIXED git argv (built from validated
 * values only — never free-form user input, never through a shell), and the
 * history-rewriting/destructive verbs (force, reset, clean, rebase) have no
 * endpoint. Inputs (branch/ref names, sha refs, commit messages) are
 * validated locally; output is bounded by execFile maxBuffer.
 */

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 4 * 1024 * 1024;

const REF_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,100}$/;

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runGit(root: string, args: string[]): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "git",
      ["--no-pager", "-c", "core.quotepath=false", ...args],
      {
        cwd: root,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        windowsHide: true,
      }
    );
    return { code: 0, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    const e = err as { code?: string | number; stdout?: string; stderr?: string; message?: string };
    if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      return { code: 1, stdout: "", stderr: "Git output was too large." };
    }
    return {
      code: typeof e.code === "number" ? e.code : 1,
      stdout: (e.stdout ?? "").trim(),
      stderr: (e.stderr ?? e.message ?? "").trim(),
    };
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

function assertRef(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 101) {
    throw new ValidationError(`${label} is required.`);
  }
  if (value.startsWith("-") || value.includes("..") || !REF_PATTERN.test(value)) {
    throw new ForbiddenError(`${label} is not allowed.`);
  }
  return value;
}

function cleanMessage(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError("A commit message is required.");
  const message = value.replace(/[\r\n]+/g, " ").trim();
  if (!message || message.length > 2000) {
    throw new ValidationError("A commit message is required (max 2000 characters).");
  }
  return message;
}

async function assertRepo(root: string): Promise<void> {
  const res = await runGit(root, ["rev-parse", "--is-inside-work-tree"]);
  if (res.code !== 0 || res.stdout !== "true") {
    throw new ValidationError("This project is not a git repository yet. Initialize one to use git operations.");
  }
}

async function ensureIdentity(root: string): Promise<void> {
  const name = await runGit(root, ["config", "--get", "user.name"]);
  if (name.code !== 0) {
    await runGit(root, ["config", "user.name", "Chatr Cloud Dev"]);
    await runGit(root, ["config", "user.email", "cloud-dev@chatr.local"]);
  }
}

async function currentBranch(root: string): Promise<{ branch: string; head: string }> {
  const branchRes = await runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const headRes = await runGit(root, ["rev-parse", "HEAD"]);
  if (branchRes.code !== 0 || headRes.code !== 0) {
    throw new ValidationError("Could not resolve the current branch.");
  }
  return { branch: branchRes.stdout, head: headRes.stdout };
}

export interface WorkspaceGitApi {
  isRepo(workspaceRoot: string): Promise<{ ok: boolean }>;
  status(workspaceRoot: string): Promise<GitStatus>;
  currentBranch(workspaceRoot: string): Promise<{ branch: string; head: string }>;
  branches(workspaceRoot: string): Promise<GitBranchEntry[]>;
  log(workspaceRoot: string, count: number): Promise<GitLogEntry[]>;
  init(workspaceRoot: string, defaultBranch: string): Promise<GitStatus>;
  createBranch(workspaceRoot: string, name: string): Promise<GitStatus>;
  checkout(workspaceRoot: string, ref: string): Promise<GitStatus>;
  commit(workspaceRoot: string, message: string): Promise<{ ref: string; message: string }>;
  stageAll(workspaceRoot: string): Promise<{ ok: true }>;
  push(workspaceRoot: string): Promise<GitPushResult>;
  pull(workspaceRoot: string): Promise<GitPushResult>;
  diff(workspaceRoot: string, filePath: string | undefined): Promise<{ diff: string }>;
}

export class WorkspaceGitApiImpl implements WorkspaceGitApi {
  /** Resolves a project workspace directory on the volume, creating it if needed. */
  async workspaceDir(root: string, projectId: string): Promise<string> {
    return ensureWorkspaceDir(root, projectId);
  }

  async isRepo(wsRoot: string): Promise<{ ok: boolean }> {
    const res = await runGit(wsRoot, ["rev-parse", "--is-inside-work-tree"]);
    return { ok: res.code === 0 && res.stdout === "true" };
  }

  async status(wsRoot: string): Promise<GitStatus> {
    await assertRepo(wsRoot);
    const res = await runGit(wsRoot, ["status", "--porcelain=v1", "-b"]);
    return parseStatus(res.stdout);
  }

  async currentBranch(wsRoot: string): Promise<{ branch: string; head: string }> {
    await assertRepo(wsRoot);
    return currentBranch(wsRoot);
  }

  async branches(wsRoot: string): Promise<GitBranchEntry[]> {
    await assertRepo(wsRoot);
    const current = await currentBranch(wsRoot);
    const res = await runGit(wsRoot, ["branch", "--format=%(refname:short)"]);
    if (res.code !== 0) return [];
    return res.stdout
      .split("\n")
      .filter(Boolean)
      .map((name) => ({ name, current: current.branch === name }));
  }

  async log(wsRoot: string, count: number): Promise<GitLogEntry[]> {
    await assertRepo(wsRoot);
    const n = Number.isInteger(count) && count >= 1 && count <= 200 ? count : 20;
    const res = await runGit(wsRoot, [
      "log",
      `-n ${n}`,
      "--pretty=format:%h|%H|%an|%ad|%s",
      "--date=short",
    ]);
    if (res.code !== 0) return [];
    return res.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [short, ref, author, date, ...subjectParts] = line.split("|");
        return {
          short: short ?? "",
          ref: ref ?? "",
          author: author ?? "",
          date: date ?? "",
          subject: subjectParts.join("|"),
        };
      });
  }

  async init(wsRoot: string, defaultBranch: string): Promise<GitStatus> {
    const branch = assertRef(defaultBranch || "main", "A default branch name");
    const res = await runGit(wsRoot, ["init", "-b", branch]);
    if (res.code !== 0) {
      throw new ValidationError(res.stderr || "Could not initialize the repository.");
    }
    await ensureIdentity(wsRoot);
    return parseStatus((await runGit(wsRoot, ["status", "--porcelain=v1", "-b"])).stdout);
  }

  async createBranch(wsRoot: string, name: string): Promise<GitStatus> {
    const safeName = assertRef(name, "A branch name");
    await assertRepo(wsRoot);
    const status = await this.status(wsRoot);
    if (!status.clean) {
      throw new ForbiddenError("Working tree is not clean. Commit or revert the changes first.");
    }
    const res = await runGit(wsRoot, ["checkout", "-b", safeName]);
    if (res.code !== 0) throw new ValidationError(res.stderr || "Could not create branch.");
    return this.status(wsRoot);
  }

  async checkout(wsRoot: string, ref: string): Promise<GitStatus> {
    const safeRef = assertRef(ref, "A branch or commit");
    await assertRepo(wsRoot);
    const status = await this.status(wsRoot);
    if (!status.clean) {
      throw new ForbiddenError("Working tree is not clean. Commit or revert the changes first.");
    }
    const res = await runGit(wsRoot, ["checkout", safeRef]);
    if (res.code !== 0) throw new ValidationError(res.stderr || "Could not switch branch.");
    return this.status(wsRoot);
  }

  async commit(wsRoot: string, message: string): Promise<{ ref: string; message: string }> {
    const safeMessage = cleanMessage(message);
    await assertRepo(wsRoot);
    await ensureIdentity(wsRoot);
    const res = await runGit(wsRoot, ["commit", "-m", safeMessage]);
    if (res.code !== 0) throw new ValidationError(res.stderr || "Commit failed.");
    const { head } = await currentBranch(wsRoot);
    return { ref: head, message: safeMessage };
  }

  async stageAll(wsRoot: string): Promise<{ ok: true }> {
    await assertRepo(wsRoot);
    const res = await runGit(wsRoot, ["add", "-A"]);
    if (res.code !== 0) throw new ValidationError(res.stderr || "Could not stage changes.");
    return { ok: true };
  }

  async push(wsRoot: string): Promise<GitPushResult> {
    await assertRepo(wsRoot);
    const res = await runGit(wsRoot, ["push"]);
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

  async pull(wsRoot: string): Promise<GitPushResult> {
    await assertRepo(wsRoot);
    const res = await runGit(wsRoot, ["pull", "--ff-only"]);
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

  async diff(wsRoot: string, filePath: string | undefined): Promise<{ diff: string }> {
    await assertRepo(wsRoot);
    if (filePath !== undefined && typeof filePath === "string" && filePath !== "") {
      if (filePath.length > 1024) throw new ValidationError("Path is too long.");
      const safeRel = filePath.replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter(Boolean).join("/");
      if (!safeRel) throw new ValidationError("Invalid path.");
      if (isSensitivePath(safeRel)) throw new ForbiddenError("This path is sensitive.");
      const res = await runGit(wsRoot, ["diff", "--", safeRel]);
      if (res.code !== 0) throw new ValidationError(res.stderr || "git diff failed.");
      return { diff: res.stdout };
    }
    const res = await runGit(wsRoot, ["diff"]);
    if (res.code !== 0) throw new ValidationError(res.stderr || "git diff failed.");
    return { diff: res.stdout };
  }
}