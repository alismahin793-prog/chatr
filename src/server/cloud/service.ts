import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { supabaseErrorToAppError } from "@/server/data/errors";
import { NotFoundError, ValidationError } from "@/server/errors";
import type { DeploymentStatus, EnvironmentVariable } from "@/server/cloud/types";

/**
 * Database access for Cloud Development. Everything runs through the service
 * role; the Cloud tables have no tenant insert/update/delete grants and their
 * reads are gated by RLS to approved super_admins.
 */

export type CloudProjectRow = Database["public"]["Tables"]["cloud_projects"]["Row"];
export type CloudOperationRow = Database["public"]["Tables"]["cloud_operations"]["Row"];
export type CloudSnapshotRow = Database["public"]["Tables"]["cloud_snapshots"]["Row"];
export type CloudDeploymentRow = Database["public"]["Tables"]["cloud_deployments"]["Row"];
export type CloudPreviewRow = Database["public"]["Tables"]["cloud_previews"]["Row"];

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

// ------------------------------------------------------------------
// Projects
// ------------------------------------------------------------------

export async function getProjectOrThrow(
  service: SupabaseClient<Database>,
  id: string
): Promise<CloudProjectRow> {
  const { data, error } = await service
    .from("cloud_projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw supabaseErrorToAppError(error);
  if (!data) throw new NotFoundError("Cloud project not found.");
  return data;
}

export function assertProjectActive(project: CloudProjectRow): void {
  if (project.status === "archived") {
    throw new ValidationError("This project is archived. Restore it before making changes.");
  }
}

export async function listProjects(
  service: SupabaseClient<Database>
): Promise<CloudProjectRow[]> {
  const { data, error } = await service
    .from("cloud_projects")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw supabaseErrorToAppError(error);
  return data ?? [];
}

export interface CreateProjectInput {
  name: string;
  slug: string;
  description?: string;
  repoUrl?: string | null;
  defaultBranch?: string;
  baseEnv?: string;
}

export async function createProject(
  service: SupabaseClient<Database>,
  input: CreateProjectInput
): Promise<CloudProjectRow> {
  if (!SLUG_PATTERN.test(input.slug)) {
    throw new ValidationError("Slug must start with a letter/digit and contain only lowercase letters, digits, and dashes.");
  }
  const { data: existing, error: existingError } = await service
    .from("cloud_projects")
    .select("id")
    .eq("slug", input.slug)
    .maybeSingle();
  if (existingError) throw supabaseErrorToAppError(existingError);
  if (existing) throw new ValidationError("A project with this slug already exists.");

  const { data, error } = await service
    .from("cloud_projects")
    .insert({
      name: input.name,
      slug: input.slug,
      description: input.description ?? "",
      repo_url: input.repoUrl ?? null,
      default_branch: input.defaultBranch ?? "main",
      base_env: input.baseEnv ?? "development",
    })
    .select("*")
    .single();
  if (error) throw supabaseErrorToAppError(error);
  return data;
}

export async function updateProject(
  service: SupabaseClient<Database>,
  id: string,
  patch: Partial<Pick<CloudProjectRow, "name" | "description" | "repo_url" | "default_branch" | "base_env">>
): Promise<CloudProjectRow> {
  const { data, error } = await service
    .from("cloud_projects")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw supabaseErrorToAppError(error);
  return data;
}

export async function setProjectStatus(
  service: SupabaseClient<Database>,
  id: string,
  status: "active" | "archived"
): Promise<CloudProjectRow> {
  const { data, error } = await service
    .from("cloud_projects")
    .update({ status })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw supabaseErrorToAppError(error);
  return data;
}

export async function touchProject(
  service: SupabaseClient<Database>,
  id: string,
  extra?: {
    lastBuildStatus?: "passed" | "failed" | "never";
    lastDeploymentStatus?: CloudProjectRow["last_deployment_status"];
  }
): Promise<void> {
  const next: Record<string, unknown> = { last_activity_at: new Date().toISOString() };
  if (extra?.lastBuildStatus) next.last_build_status = extra.lastBuildStatus;
  if (extra?.lastDeploymentStatus) next.last_deployment_status = extra.lastDeploymentStatus;
  const { error } = await service.from("cloud_projects").update(next as never).eq("id", id);
  if (error) throw supabaseErrorToAppError(error);
}

// ------------------------------------------------------------------
// Operations
// ------------------------------------------------------------------

export type CloudOperationKind = CloudOperationRow["kind"];
export type CloudOperationStatus = CloudOperationRow["status"];

export interface CreateOperationInput {
  projectId: string;
  kind: CloudOperationKind;
  program: string;
  args: string[];
  workingDir?: string | null;
  adminId?: string | null;
}

export async function createOperation(
  service: SupabaseClient<Database>,
  input: CreateOperationInput
): Promise<CloudOperationRow> {
  const { data, error } = await service
    .from("cloud_operations")
    .insert({
      project_id: input.projectId,
      kind: input.kind,
      status: "running",
      program: input.program,
      args: input.args,
      working_dir: input.workingDir ?? null,
      admin_id: input.adminId ?? null,
      started_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw supabaseErrorToAppError(error);
  return data;
}

export async function finishOperation(
  service: SupabaseClient<Database>,
  id: string,
  input: {
    status: CloudOperationStatus;
    exitCode: number | null;
    durationMs: number | null;
    outputHead: string;
    outputTruncated: boolean;
  }
): Promise<void> {
  const { error } = await service
    .from("cloud_operations")
    .update({
      status: input.status,
      exit_code: input.exitCode,
      duration_ms: input.durationMs,
      output_head: input.outputHead,
      output_truncated: input.outputTruncated,
      completed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw supabaseErrorToAppError(error);
}

export async function listOperations(
  service: SupabaseClient<Database>,
  projectId?: string,
  limit = 50
): Promise<CloudOperationRow[]> {
  let q = service.from("cloud_operations").select("*").order("created_at", { ascending: false }).limit(limit);
  if (projectId) q = q.eq("project_id", projectId);
  const { data, error } = await q;
  if (error) throw supabaseErrorToAppError(error);
  return data ?? [];
}

export async function getOperation(
  service: SupabaseClient<Database>,
  id: string
): Promise<CloudOperationRow> {
  const { data, error } = await service
    .from("cloud_operations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw supabaseErrorToAppError(error);
  if (!data) throw new NotFoundError("Operation not found.");
  return data;
}

// ------------------------------------------------------------------
// Snapshots
// ------------------------------------------------------------------

export async function listSnapshots(
  service: SupabaseClient<Database>,
  projectId: string
): Promise<CloudSnapshotRow[]> {
  const { data, error } = await service
    .from("cloud_snapshots")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw supabaseErrorToAppError(error);
  return data ?? [];
}

export async function createSnapshotRow(
  service: SupabaseClient<Database>,
  input: { projectId: string; reason: string; ref: string; createdBy?: string | null }
): Promise<CloudSnapshotRow> {
  const { data, error } = await service
    .from("cloud_snapshots")
    .insert({
      project_id: input.projectId,
      reason: input.reason,
      ref: input.ref,
      created_by: input.createdBy ?? null,
    })
    .select("*")
    .single();
  if (error) throw supabaseErrorToAppError(error);
  return data;
}

export async function setSnapshotStatus(
  service: SupabaseClient<Database>,
  id: string,
  status: CloudSnapshotRow["status"],
  restoredAt?: string
): Promise<CloudSnapshotRow> {
  const { data, error } = await service
    .from("cloud_snapshots")
    .update({ status, restored_at: restoredAt ?? null })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw supabaseErrorToAppError(error);
  return data;
}

export async function getSnapshotOrThrow(
  service: SupabaseClient<Database>,
  id: string
): Promise<CloudSnapshotRow> {
  const { data, error } = await service
    .from("cloud_snapshots")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw supabaseErrorToAppError(error);
  if (!data) throw new NotFoundError("Snapshot not found.");
  return data;
}

// ------------------------------------------------------------------
// Deployments
// ------------------------------------------------------------------

export async function listDeployments(
  service: SupabaseClient<Database>,
  projectId?: string,
  limit = 50
): Promise<CloudDeploymentRow[]> {
  let q = service.from("cloud_deployments").select("*").order("created_at", { ascending: false }).limit(limit);
  if (projectId) q = q.eq("project_id", projectId);
  const { data, error } = await q;
  if (error) throw supabaseErrorToAppError(error);
  return data ?? [];
}

export async function createDeploymentRow(
  service: SupabaseClient<Database>,
  input: {
    projectId: string;
    kind: "preview" | "production";
    ref: string;
    branch?: string | null;
    requestId?: string | null;
    initiatedBy?: string | null;
  }
): Promise<CloudDeploymentRow> {
  const { data, error } = await service
    .from("cloud_deployments")
    .insert({
      project_id: input.projectId,
      kind: input.kind,
      ref: input.ref,
      branch: input.branch ?? null,
      status: "queued",
      request_id: input.requestId ?? null,
      initiated_by: input.initiatedBy ?? null,
    })
    .select("*")
    .single();
  if (error) throw supabaseErrorToAppError(error);
  return data;
}

export async function syncDeploymentResult(
  service: SupabaseClient<Database>,
  id: string,
  result: { status: DeploymentStatus; url?: string | null; buildLogsHead?: string }
): Promise<CloudDeploymentRow> {
  const patch: {
    status: DeploymentStatus;
    url?: string | null;
    build_logs_head?: string;
    completed_at?: string;
  } = { status: result.status };
  if (result.url !== undefined) patch.url = result.url;
  if (result.buildLogsHead !== undefined) patch.build_logs_head = result.buildLogsHead;
  if (result.status === "ready" || result.status === "failed" || result.status === "cancelled") {
    patch.completed_at = new Date().toISOString();
  }
  const { data, error } = await service
    .from("cloud_deployments")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw supabaseErrorToAppError(error);
  return data;
}

export async function markDeploymentRolledBack(
  service: SupabaseClient<Database>,
  id: string
): Promise<CloudDeploymentRow> {
  const { data, error } = await service
    .from("cloud_deployments")
    .update({ status: "rolled_back", rolled_back_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw supabaseErrorToAppError(error);
  return data;
}

export async function getDeploymentRow(
  service: SupabaseClient<Database>,
  id: string
): Promise<CloudDeploymentRow> {
  const { data, error } = await service
    .from("cloud_deployments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw supabaseErrorToAppError(error);
  if (!data) throw new NotFoundError("Deployment not found.");
  return data;
}

// ------------------------------------------------------------------
// Previews
// ------------------------------------------------------------------

export async function listPreviews(
  service: SupabaseClient<Database>,
  projectId?: string
): Promise<CloudPreviewRow[]> {
  let q = service.from("cloud_previews").select("*").order("created_at", { ascending: false }).limit(50);
  if (projectId) q = q.eq("project_id", projectId);
  const { data, error } = await q;
  if (error) throw supabaseErrorToAppError(error);
  return data ?? [];
}

export async function createPreviewRow(
  service: SupabaseClient<Database>,
  input: {
    projectId: string;
    deploymentId?: string | null;
    commit?: string | null;
  }
): Promise<CloudPreviewRow> {
  const { data, error } = await service
    .from("cloud_previews")
    .insert({
      project_id: input.projectId,
      deployment_id: input.deploymentId ?? null,
      commit: input.commit ?? null,
    })
    .select("*")
    .single();
  if (error) throw supabaseErrorToAppError(error);
  return data;
}

export async function syncPreviewResult(
  service: SupabaseClient<Database>,
  id: string,
  patch: { status?: CloudPreviewRow["status"]; url?: string | null; expires_at?: string | null }
): Promise<void> {
  const { error } = await service.from("cloud_previews").update(patch).eq("id", id);
  if (error) throw supabaseErrorToAppError(error);
}

// ------------------------------------------------------------------
// Environment metadata (names/state only — never values)
// ------------------------------------------------------------------

export function envVarsOf(project: CloudProjectRow): EnvironmentVariable[] {
  return Array.isArray(project.env_vars) ? (project.env_vars as unknown as EnvironmentVariable[]) : [];
}

export async function setEnvVarMetadata(
  service: SupabaseClient<Database>,
  projectId: string,
  name: string,
  configured: boolean
): Promise<CloudProjectRow> {
  const project = await getProjectOrThrow(service, projectId);
  const list = envVarsOf(project).filter((entry) => entry.name !== name);
  list.push({ name, configured, updatedAt: configured ? new Date().toISOString() : null });
  const { data, error } = await service
    .from("cloud_projects")
    .update({ env_vars: list as never })
    .eq("id", projectId)
    .select("*")
    .single();
  if (error) throw supabaseErrorToAppError(error);
  return data;
}

// ------------------------------------------------------------------
// Stats (dashboard + hub)
// ------------------------------------------------------------------

export interface CloudStats {
  projects: number;
  activeProjects: number;
  runningOperations: number;
  lastBuild: "passed" | "failed" | "never";
  deployments: number;
  readyDeployments: number;
  activePreviews: number;
  snapshots: number;
  lastDeploymentAt: string | null;
}

export async function cloudStats(service: SupabaseClient<Database>): Promise<CloudStats> {
  const [projectsData, running, ready, previews, snapshotsArr, deploymentsData] = await Promise.all([
    service.from("cloud_projects").select("id, status, last_build_status"),
    service.from("cloud_operations").select("id", { count: "exact", head: true }).eq("status", "running"),
    service.from("cloud_deployments").select("id", { count: "exact", head: true }).eq("status", "ready"),
    service.from("cloud_previews").select("id", { count: "exact", head: true }).eq("status", "ready"),
    service.from("cloud_snapshots").select("id", { count: "exact", head: true }),
    service.from("cloud_deployments").select("created_at").order("created_at", { ascending: false }).limit(1),
  ]);
  for (const res of [projectsData, running, ready, previews, snapshotsArr, deploymentsData]) {
    if (res.error) throw supabaseErrorToAppError(res.error);
  }
  const rows = projectsData.data ?? [];
  const lastBuild: "passed" | "failed" | "never" = rows.some((p) => p.last_build_status === "passed")
    ? "passed"
    : rows.some((p) => p.last_build_status === "failed")
      ? "failed"
      : "never";
  return {
    projects: rows.length,
    activeProjects: rows.filter((p) => p.status === "active").length,
    runningOperations: running.count ?? 0,
    lastBuild,
    deployments: deploymentsData.count ?? 0,
    readyDeployments: ready.count ?? 0,
    activePreviews: previews.count ?? 0,
    snapshots: snapshotsArr.count ?? 0,
    lastDeploymentAt: deploymentsData.data?.[0]?.created_at ?? null,
  };
}