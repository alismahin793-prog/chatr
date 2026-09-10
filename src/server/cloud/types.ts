/**
 * Shared types and provider contracts for the Cloud Development environment.
 *
 * Providers are real interfaces because a per-tenant zone that can execute
 * arbitrary commands and push to a deployment pipeline CANNOT rely on the
 * Vercel serverless runtime (no persistent processes/shared local disk across
 * invocations). The default providers are always honest: a provider that is
 * not configured reports itself as such instead of pretending to work.
 */

// ------------------------------------------------------------------
// Execution (commands / pipelines)
// ------------------------------------------------------------------

export type ProcessState =
  | "running"
  | "completed"
  | "cancelled"
  | "timed_out"
  | "error";

export interface ProcessSnapshot {
  id: string;
  program: string;
  args: string[];
  state: ProcessState;
  exitCode: number | null;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  bytes: number;
  truncated: boolean;
  message?: string;
}

export interface OutputChunk {
  seq: number;
  kind: "stdout" | "stderr";
  text: string;
}

export interface RunOptions {
  id: string;
  program: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface PollResult {
  snapshot: ProcessSnapshot;
  newOutput: OutputChunk[];
  error?: string;
}

export type ExecutionProviderStatus =
  | {
      configured: true;
      id: string;
      label: string;
      description: string;
    }
  | {
      configured: false;
      id: string;
      label: string;
      description: string;
      reason: string;
    };

export interface CloudExecutionProvider {
  readonly id: string;
  status(): ExecutionProviderStatus;
  run(options: RunOptions): Promise<ProcessSnapshot>;
  poll(id: string, since: number): PollResult;
  cancel(id: string): Promise<ProcessSnapshot>;
  list(): ProcessSnapshot[];
}

// ------------------------------------------------------------------
// Workspace (file system)
// ------------------------------------------------------------------

/** Non-secret name/path in the provider help text / descriptions. */
export interface FileEntity {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number | null;
}

export interface WorkspaceProvider {
  readonly id: string;
  status(): ExecutionProviderStatus;
  /** Absolute path to the project's workspace root (created lazily). */
  resolveRoot(projectId: string): string;
  listDir(root: string, relPath: string, options?: { depth?: number }): Promise<FileEntity[]>;
  readFile(root: string, relPath: string): Promise<{ path: string; content: string; size: number }>;
  writeFile(root: string, relPath: string, content: string): Promise<{ path: string; size: number }>;
  createDir(root: string, relPath: string): Promise<void>;
  renamePath(root: string, from: string, to: string): Promise<void>;
  deletePath(root: string, relPath: string, options?: { recursive?: boolean }): Promise<void>;
  search(root: string, query: string): Promise<FileEntity[]>;
}

// ------------------------------------------------------------------
// Git
// ------------------------------------------------------------------

export interface GitStatusEntry {
  x: string;
  y: string;
  path: string;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  clean: boolean;
  files: GitStatusEntry[];
}

export interface GitLogEntry {
  short: string;
  ref: string;
  subject: string;
  author: string;
  date: string;
}

export interface GitBranchEntry {
  current: boolean;
  name: string;
}

export interface GitPushResult {
  ok: boolean;
  message: string;
}

export interface GitProvider {
  readonly id: string;
  providerStatus(): ExecutionProviderStatus;
  isGitRepo(root: string): Promise<boolean>;
  status(root: string): Promise<GitStatus>;
  diff(root: string, path?: string): Promise<string>;
  log(root: string, count?: number): Promise<GitLogEntry[]>;
  branches(root: string): Promise<GitBranchEntry[]>;
  currentBranch(root: string): Promise<{ branch: string; head: string }>;
  /** Initializes a repository (safe, no history rewrite) when one does not exist. */
  init(root: string, defaultBranch?: string): Promise<GitStatus>;
  /** Creates and switches to a new branch (fails if the repo is dirty). */
  createBranch(root: string, name: string): Promise<GitStatus>;
  /** Safe switch — refuses to run when the working tree is dirty. */
  checkout(root: string, ref: string): Promise<GitStatus>;
  commit(root: string, message: string): Promise<{ ref: string; message: string }>;
  /** Stages every working-tree change (respects .gitignore) for a subsequent commit. */
  stageAll(root: string): Promise<void>;
  /** fast-forward-only; never force-pulls. */
  pull(root: string): Promise<{ ok: boolean; message: string }>;
  /** never force-pushes. */
  push(root: string): Promise<GitPushResult>;
}

// ------------------------------------------------------------------
// Deployments / previews
// ------------------------------------------------------------------

export type DeploymentKind = "production" | "preview";
export type DeploymentStatus = "queued" | "building" | "ready" | "failed" | "cancelled";

export interface DeploymentProviderStatus {
  configured: boolean;
  id: string;
  label: string;
  reason?: string;
  providerProjectId?: string;
}

export interface CreateDeploymentInput {
  projectId: string;
  ref: string;
  branch: string;
  workspaceRoot: string;
  kind: DeploymentKind;
}

export interface CreatedDeployment {
  requestId: string;
  status: DeploymentStatus;
  url: string | null;
}

export interface DeploymentProvider {
  readonly id: string;
  status(): DeploymentProviderStatus;
  createDeployment(input: CreateDeploymentInput): Promise<CreatedDeployment>;
  getDeployment(requestId: string): Promise<CreatedDeployment>;
  cancelDeployment(requestId: string): Promise<void>;
}

// ------------------------------------------------------------------
// Environments (secret metadata only)
// ------------------------------------------------------------------

export interface EnvironmentVariable {
  name: string;
  configured: boolean;
  updatedAt: string | null;
}

// ------------------------------------------------------------------
// Pipeline catalogue (the approved, audited command set)
// ------------------------------------------------------------------

export interface PipelineStep {
  key: "install" | "lint" | "typecheck" | "test" | "gate" | "build";
  label: string;
  program: string;
  args: string[];
  timeoutMs: number;
  maxOutputBytes: number;
  description: string;
}

export const CLOUD_PIPELINE_STEPS: readonly PipelineStep[] = [
  {
    key: "install",
    label: "Install dependencies",
    program: "npm",
    args: ["install"],
    timeoutMs: 10 * 60_000,
    maxOutputBytes: 512 * 1024,
    description: "npm install",
  },
  {
    key: "lint",
    label: "Lint",
    program: "npm",
    args: ["run", "lint"],
    timeoutMs: 5 * 60_000,
    maxOutputBytes: 512 * 1024,
    description: "npm run lint",
  },
  {
    key: "typecheck",
    label: "Type check",
    program: "npm",
    args: ["run", "typecheck"],
    timeoutMs: 5 * 60_000,
    maxOutputBytes: 512 * 1024,
    description: "npm run typecheck",
  },
  {
    key: "test",
    label: "Tests",
    program: "npm",
    args: ["test"],
    timeoutMs: 10 * 60_000,
    maxOutputBytes: 512 * 1024,
    description: "npm test",
  },
  {
    key: "gate",
    label: "Full gate",
    program: "npm",
    args: ["run", "test:gate"],
    timeoutMs: 15 * 60_000,
    maxOutputBytes: 1024 * 1024,
    description: "npm run test:gate",
  },
  {
    key: "build",
    label: "Production build",
    program: "npm",
    args: ["run", "build"],
    timeoutMs: 15 * 60_000,
    maxOutputBytes: 1024 * 1024,
    description: "npm run build",
  },
];