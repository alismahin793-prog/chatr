/**
 * Client-side API helper for the Cloud Development admin UI. All mutations
 * hit the server routes which independently enforce super_admin identity +
 * the 30-second re-auth window — never trust the UI.
 */

export interface ApiError extends Error {
  code?: string;
}

async function parse<T>(res: Response): Promise<T> {
  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  const body = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  const err = new Error(body?.error?.message ?? "Request failed.") as ApiError;
  err.code = body?.error?.code;
  throw err;
}

function get<T>(url: string): Promise<T> {
  return fetch(url, { cache: "no-store" }).then(parse<T>);
}

function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  return fetch(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then(parse<T>);
}

export const cloudApi = {
  providers: () => get<ProvidersPayload>("/api/admin/cloud/providers"),
  projects: {
    list: () => get<{ projects: Project[] }>("/api/admin/cloud/projects"),
    get: (id: string) => get<{ project: ProjectDetail }>(`/api/admin/cloud/projects/${id}`),
    create: (input: { name: string; slug: string; description?: string; repoUrl?: string | null }) =>
      send<{ project: Project }>("/api/admin/cloud/projects", "POST", input),
    archive: (id: string) => send<{ project: Project }>(`/api/admin/cloud/projects/${id}`, "DELETE"),
  },
  files: {
    list: (projectId: string, path = ".") =>
      get<{ entries: FileEntry[] }>(
        `/api/admin/cloud/files?projectId=${projectId}&path=${encodeURIComponent(path)}&mode=list`
      ),
    read: (projectId: string, path: string) =>
      get<{ file: { path: string; content: string; size: number } }>(
        `/api/admin/cloud/files?projectId=${projectId}&path=${encodeURIComponent(path)}&mode=read`
      ),
    search: (projectId: string, q: string) =>
      get<{ entries: FileEntry[] }>(
        `/api/admin/cloud/files?projectId=${projectId}&q=${encodeURIComponent(q)}&mode=search`
      ),
    write: (projectId: string, path: string, content: string) =>
      send<{ file: { path: string; size: number } }>(
        `/api/admin/cloud/files?projectId=${projectId}`,
        "PUT",
        { path, content }
      ),
    mkdir: (projectId: string, path: string) =>
      send<{ ok: true }>(`/api/admin/cloud/files?projectId=${projectId}`, "POST", { path }),
    rename: (projectId: string, from: string, to: string) =>
      send<{ ok: true }>(`/api/admin/cloud/files?projectId=${projectId}`, "PATCH", { from, to }),
    del: (projectId: string, path: string, recursive: boolean) =>
      fetch(`/api/admin/cloud/files?projectId=${projectId}&path=${encodeURIComponent(path)}&recursive=${recursive ? "1" : "0"}`, {
        method: "DELETE",
      }).then(parse<{ ok: true }>),
  },
  execute: (projectId: string, command: string, kind = "command") =>
    send<{ operationId: string; process: { state: string; exitCode: number | null } }>(
      "/api/admin/cloud/execute",
      "POST",
      { projectId, command, kind }
    ),
  cancel: (opId: string) =>
    send<{ ok: true }>(`/api/admin/cloud/execute/operations/${opId}/cancel`, "POST", {}),
  operations: (projectId?: string) =>
    get<{ operations: CloudOperation[] }>(
      `/api/admin/cloud/execute/operations${projectId ? `?projectId=${projectId}` : ""}`
    ),
  pipeline: (projectId: string, step: string) =>
    send<{ operationId: string; step: string; process: { state: string; exitCode: number | null } }>(
      "/api/admin/cloud/pipeline",
      "POST",
      { projectId, step }
    ),
  git: {
    status: (projectId: string) =>
      get<{ status: GitStatusData }>(`/api/admin/cloud/git?projectId=${projectId}&action=status`),
    diff: (projectId: string, path?: string) =>
      get<{ diff: string }>(
        `/api/admin/cloud/git?projectId=${projectId}&action=diff${path ? `&path=${encodeURIComponent(path)}` : ""}`
      ),
    log: (projectId: string) =>
      get<{ log: GitLogEntry[] }>(`/api/admin/cloud/git?projectId=${projectId}&action=log`),
    branches: (projectId: string) =>
      get<{ branches: GitBranchEntry[]; current: { branch: string; head: string } }>(
        `/api/admin/cloud/git?projectId=${projectId}&action=branches`
      ),
    act: (input: { projectId: string; action: string; branch?: string; message?: string }) =>
      send<{ result: Record<string, unknown> }>("/api/admin/cloud/git", "POST", input),
  },
  snapshots: {
    list: (projectId: string) =>
      get<{ snapshots: CloudSnapshot[] }>(`/api/admin/cloud/projects/${projectId}/snapshots`),
    create: (projectId: string, reason: string) =>
      send<{ snapshot: CloudSnapshot }>(`/api/admin/cloud/projects/${projectId}/snapshots`, "POST", { reason }),
    restore: (projectId: string, snapshotId: string) =>
      send<{ ok: true; ref: string }>(
        `/api/admin/cloud/projects/${projectId}/snapshots/${snapshotId}/restore`,
        "POST",
        { confirm: true }
      ),
  },
  deployments: {
    list: (projectId?: string) =>
      get<{ deployments: CloudDeployment[] }>(
        `/api/admin/cloud/deployments${projectId ? `?projectId=${projectId}` : ""}`
      ),
    create: (input: { projectId: string; kind: "production" | "preview"; branch?: string }) =>
      send<{ deployment: { id: string; status: string; url: string | null; requestId: string } }>(
        "/api/admin/cloud/deployments",
        "POST",
        input
      ),
    get: (id: string) => get<{ deployment: CloudDeployment; refreshed: unknown }>(`/api/admin/cloud/deployments/${id}`),
    cancel: (id: string) => send<{ ok: true }>(`/api/admin/cloud/deployments/${id}/cancel`, "POST", {}),
    rollback: (id: string) =>
      send<{ ok: true; rollback: { from: string; to: string; ref: string; status: string } }>(
        `/api/admin/cloud/deployments/${id}/rollback`,
        "POST",
        { deploymentId: id, confirm: true }
      ),
  },
  previews: {
    list: (projectId?: string) =>
      get<{ previews: CloudPreview[] }>(
        `/api/admin/cloud/previews${projectId ? `?projectId=${projectId}` : ""}`
      ),
    create: (projectId: string) =>
      send<{ preview: { id: string }; deployment: { id: string } }>(
        "/api/admin/cloud/previews",
        "POST",
        { projectId, kind: "preview" }
      ),
  },
  env: {
    list: (projectId: string) =>
      get<{ environment: { providerConfigured: boolean; vars: EnvVar[] } }>(
        `/api/admin/cloud/environments?projectId=${projectId}`
      ),
    set: (projectId: string, name: string, value: string) =>
      send<{ ok: true; envVar: { name: string; configured: boolean } }>(
        "/api/admin/cloud/environments",
        "POST",
        { projectId, name, value }
      ),
  },
  selfDevelopment: {
    list: () => get<{ requests: SelfDevelopmentRequestView[] }>("/api/admin/cloud/self-development"),
    get: (id: string) =>
      get<SelfDevelopmentDetail>(`/api/admin/cloud/self-development/${id}`),
    create: (input: { projectId: string; prompt: string }) =>
      send<{ request: SelfDevelopmentRequest; project: SelfDevelopmentProject }>(
        "/api/admin/cloud/self-development",
        "POST",
        input
      ),
    action: (
      id: string,
      input: { action: SelfDevelopmentAction; acknowledgeCritical?: boolean; confirm?: boolean }
    ) =>
      send<{ request: SelfDevelopmentRequest; project: SelfDevelopmentProject }>(
        `/api/admin/cloud/self-development/${id}/actions`,
        "POST",
        input
      ),
  },
};

// ------------------------------------------------------------------
// Shared payload types consumed by the Cloud Development UI
// ------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  slug: string;
  status: "active" | "archived";
  lastBuildStatus: string;
  lastDeploymentStatus: string;
  updatedAt: string;
}

export interface ProjectDetail {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: "active" | "archived";
  repoUrl: string | null;
  defaultBranch: string;
  baseEnv: string;
  envVarCount: number;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number | null;
}

export interface CloudOperation {
  id: string;
  project_id: string;
  kind: string;
  status: string;
  program: string;
  args: string[];
  exit_code: number | null;
  duration_ms: number | null;
  output_head: string;
  created_at: string;
}

export interface GitStatusData {
  branch: string;
  ahead: number;
  behind: number;
  clean: boolean;
  files: { x: string; y: string; path: string }[];
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

export interface CloudSnapshot {
  id: string;
  project_id: string;
  reason: string;
  ref: string;
  status: string;
  created_at: string;
  restored_at: string | null;
}

export interface CloudDeployment {
  id: string;
  project_id: string;
  kind: "production" | "preview";
  ref: string;
  branch: string | null;
  status: string;
  url: string | null;
  request_id: string | null;
  created_at: string;
  completed_at: string | null;
  rolled_back_at: string | null;
}

export interface CloudPreview {
  id: string;
  project_id: string;
  deployment_id: string | null;
  commit: string | null;
  status: string;
  url: string | null;
  created_at: string;
}

export interface EnvVar {
  name: string;
  configured: boolean;
  updatedAt: string | null;
}

export interface ProvidersPayload {
  providers: {
    execution: { configured: boolean; id: string; label: string; description: string; reason?: string };
    workspace: { configured: boolean; id: string; label: string; description: string };
    git: { configured: boolean; id: string; label: string; description: string };
    deployment: { configured: boolean; id: string; label: string; reason?: string };
  };
  pipeline: { key: string; label: string; description: string }[];
}

// ------------------------------------------------------------------
// Self-Development Engine client types
// ------------------------------------------------------------------

export type SelfDevelopmentAction =
  | "start-planning"
  | "approve-plan"
  | "reject-plan"
  | "run"
  | "approve-deploy"
  | "cancel"
  | "rollback";

/** Subset of cloud_project columns surfaced to the self-development UI. */
export interface SelfDevelopmentProject {
  id: string;
  name: string;
  slug: string;
  status: "active" | "archived";
  default_branch: string;
  last_build_status: string;
  last_deployment_status: string;
}

export interface SelfDevelopmentRequest {
  id: string;
  project_id: string;
  requested_by: string | null;
  prompt: string;
  status: SelfDevelopmentRequestStatusLabel;
  risk_level: "low" | "medium" | "high" | "critical";
  plan: SelfDevelopmentPlan | null;
  review: SelfDevelopmentReview | null;
  branch: string | null;
  snapshot_id: string | null;
  deployment_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  plan_approved_by: string | null;
  plan_approved_at: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SelfDevelopmentRequestView {
  request: SelfDevelopmentRequest;
  project: SelfDevelopmentProject;
}

export interface SelfDevelopmentPlan {
  goal: string;
  currentArchitecture: string;
  affectedFiles: string[];
  affectedSystems: string[];
  requiredChanges: string;
  potentialRisks: string;
  databaseChanges: string;
  apiChanges: string;
  uiChanges: string;
  securityImpact: string;
  testingStrategy: string;
  deploymentImpact: string;
  rollbackStrategy: string;
}

export interface SelfDevelopmentReview {
  result: "approved" | "needs_changes" | "blocked";
  summary: string;
  security: string;
  correctness: string;
  architecture: string;
  regressionRisk: string;
  performance: string;
  codeQuality: string;
  tests: string;
  databaseImpact: string;
  authImpact: string;
  deploymentImpact: string;
  reviewedAt: string;
}

export interface SelfDevelopmentStep {
  id: string;
  request_id: string;
  stage: string;
  status: "pending" | "running" | "passed" | "failed" | "cancelled";
  operation_id: string | null;
  exit_code: number | null;
  duration_ms: number | null;
  output_head: string;
  output_truncated: boolean;
  error: string | null;
  step_order: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface SelfDevelopmentChange {
  id: string;
  request_id: string;
  file: string;
  operation: "create" | "edit" | "rename" | "delete";
  path_from: string | null;
  path_to: string | null;
  diff: string;
  before_sha256: string | null;
  after_sha256: string | null;
  created_at: string;
}

export type SelfDevelopmentRequestStatusLabel =
  | "draft"
  | "planning"
  | "awaiting_plan_approval"
  | "snapshotting"
  | "workspace_preparing"
  | "analyzing"
  | "modifying"
  | "testing"
  | "typechecking"
  | "linting"
  | "building"
  | "reviewing"
  | "awaiting_deploy_approval"
  | "deploying"
  | "verifying"
  | "completed"
  | "failed"
  | "rolled_back"
  | "cancelled"
  | "rejected";

export interface SelfDevelopmentDetail {
  request: SelfDevelopmentRequest;
  project: SelfDevelopmentProject;
  steps: SelfDevelopmentStep[];
  changes: SelfDevelopmentChange[];
}