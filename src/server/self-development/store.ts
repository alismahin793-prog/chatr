import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { supabaseErrorToAppError } from "@/server/data/errors";
import {
  createDeploymentRow,
  createSnapshotRow,
  getProjectOrThrow,
  markDeploymentRolledBack,
  setSnapshotStatus,
  syncDeploymentResult,
  type CloudProjectRow,
  type CloudSnapshotRow,
} from "@/server/cloud/service";
import { NotFoundError } from "@/server/errors";
import type {
  SelfDevelopmentPlan,
  SelfDevelopmentRequestStatus,
  SelfDevelopmentReview,
  SelfDevelopmentRiskLevel,
  SelfDevelopmentStepStatus,
} from "@/lib/supabase/database.types";

type SelfDevelopmentRequestRow = Database["public"]["Tables"]["self_development_requests"]["Row"];
type SelfDevelopmentStepRow = Database["public"]["Tables"]["self_development_steps"]["Row"];

/** Request + its Cloud project, the view the engine and UI work with. */
export interface SelfDevelopmentRequestView {
  request: SelfDevelopmentRequestRow;
  project: CloudProjectRow;
}

/** Allowlist of request fields the engine may update. */
export interface RequestPatch {
  status?: SelfDevelopmentRequestStatus;
  risk_level?: SelfDevelopmentRiskLevel;
  plan?: SelfDevelopmentPlan | null;
  review?: SelfDevelopmentReview | null;
  branch?: string | null;
  snapshot_id?: string | null;
  deployment_id?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  plan_approved_by?: string | null;
  plan_approved_at?: string | null;
  error?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface NewStepInput {
  requestId: string;
  stage: string;
  status?: SelfDevelopmentStepStatus;
  stepOrder: number;
  operationId?: string | null;
}

export interface StepPatch {
  status?: SelfDevelopmentStepStatus;
  exit_code?: number | null;
  duration_ms?: number | null;
  output_head?: string;
  output_truncated?: boolean;
  error?: string | null;
  operation_id?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface NewChangeInput {
  requestId: string;
  file: string;
  operation: "create" | "edit" | "rename" | "delete";
  pathFrom?: string | null;
  pathTo?: string | null;
  diff: string;
  beforeSha256?: string | null;
  afterSha256?: string | null;
}

export interface SnapshotRef {
  id: string;
  ref: string;
  status: CloudSnapshotRow["status"];
}

/**
 * The persistence boundary of the Self-Development Engine. The orchestrator
 * depends only on this interface; the Supabase implementation delegates to the
 * existing cloud services, and a memory implementation exists for tests.
 */
export interface SelfDevelopmentStore {
  createRequest(input: { projectId: string; requestedBy: string | null; prompt: string }): Promise<SelfDevelopmentRequestView>;
  getRequest(id: string): Promise<SelfDevelopmentRequestView | null>;
  updateRequest(id: string, patch: RequestPatch): Promise<void>;
  listRequests(): Promise<SelfDevelopmentRequestView[]>;

  addStep(input: NewStepInput): Promise<SelfDevelopmentStepRow>;
  updateStep(id: string, patch: StepPatch): Promise<void>;
  listSteps(requestId: string): Promise<SelfDevelopmentStepRow[]>;

  addChange(input: NewChangeInput): Promise<void>;
  listChanges(requestId: string): Promise<Array<Database["public"]["Tables"]["self_development_changes"]["Row"]>>;

  createSnapshot(input: { projectId: string; reason: string; ref: string; createdBy?: string | null }): Promise<SnapshotRef>;
  setSnapshotStatus(id: string, status: CloudSnapshotRow["status"]): Promise<void>;
  getSnapshot(id: string): Promise<SnapshotRef | null>;

  createDeployment(input: {
    projectId: string;
    kind: "preview" | "production";
    ref: string;
    branch?: string | null;
    requestId?: string | null;
    initiatedBy?: string | null;
  }): Promise<{ id: string }>;
  syncDeployment(id: string, result: { status: string; url?: string | null }): Promise<void>;
  markDeploymentRolledBack(id: string): Promise<void>;
}

export class SupabaseSelfDevelopmentStore implements SelfDevelopmentStore {
  constructor(private readonly service: SupabaseClient<Database>) {}

  async createRequest(input: {
    projectId: string;
    requestedBy: string | null;
    prompt: string;
  }): Promise<SelfDevelopmentRequestView> {
    const { data, error } = await this.service
      .from("self_development_requests")
      .insert({ project_id: input.projectId, requested_by: input.requestedBy, prompt: input.prompt })
      .select("*")
      .single();
    if (error) throw supabaseErrorToAppError(error);
    const project = await getProjectOrThrow(this.service, input.projectId);
    return { request: data, project };
  }

  async getRequest(id: string): Promise<SelfDevelopmentRequestView | null> {
    const { data, error } = await this.service
      .from("self_development_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw supabaseErrorToAppError(error);
    if (!data) return null;
    const project = await getProjectOrThrow(this.service, data.project_id);
    return { request: data, project };
  }

  async updateRequest(id: string, patch: RequestPatch): Promise<void> {
    const { error } = await this.service
      .from("self_development_requests")
      .update(patch)
      .eq("id", id);
    if (error) throw supabaseErrorToAppError(error);
  }

  async listRequests(): Promise<SelfDevelopmentRequestView[]> {
    const { data, error } = await this.service
      .from("self_development_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw supabaseErrorToAppError(error);
    const rows = data ?? [];
    const projectIds = [...new Set(rows.map((row) => row.project_id))];
    const { data: projects, error: projectError } = await this.service
      .from("cloud_projects")
      .select("*")
      .in("id", projectIds);
    if (projectError) throw supabaseErrorToAppError(projectError);
    const projectMap = new Map((projects ?? []).map((project) => [project.id, project]));
    return rows
      .filter((row) => projectMap.has(row.project_id))
      .map((request) => ({
        request,
        project: projectMap.get(request.project_id) as CloudProjectRow,
      }));
  }

  async addStep(input: NewStepInput): Promise<SelfDevelopmentStepRow> {
    const { data, error } = await this.service
      .from("self_development_steps")
      .insert({
        request_id: input.requestId,
        stage: input.stage,
        status: input.status ?? "pending",
        step_order: input.stepOrder,
        operation_id: input.operationId ?? null,
        started_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (error) throw supabaseErrorToAppError(error);
    return data;
  }

  async updateStep(id: string, patch: StepPatch): Promise<void> {
    const { error } = await this.service
      .from("self_development_steps")
      .update(patch)
      .eq("id", id);
    if (error) throw supabaseErrorToAppError(error);
  }

  async listSteps(requestId: string): Promise<SelfDevelopmentStepRow[]> {
    const { data, error } = await this.service
      .from("self_development_steps")
      .select("*")
      .eq("request_id", requestId)
      .order("step_order", { ascending: true });
    if (error) throw supabaseErrorToAppError(error);
    return data ?? [];
  }

  async addChange(input: NewChangeInput): Promise<void> {
    const { error } = await this.service
      .from("self_development_changes")
      .insert({
        request_id: input.requestId,
        file: input.file,
        operation: input.operation,
        path_from: input.pathFrom ?? null,
        path_to: input.pathTo ?? null,
        diff: input.diff,
        before_sha256: input.beforeSha256 ?? null,
        after_sha256: input.afterSha256 ?? null,
      });
    if (error) throw supabaseErrorToAppError(error);
  }

  async listChanges(requestId: string): Promise<Array<Database["public"]["Tables"]["self_development_changes"]["Row"]>> {
    const { data, error } = await this.service
      .from("self_development_changes")
      .select("*")
      .eq("request_id", requestId)
      .order("created_at", { ascending: true });
    if (error) throw supabaseErrorToAppError(error);
    return data ?? [];
  }

  async createSnapshot(input: {
    projectId: string;
    reason: string;
    ref: string;
    createdBy?: string | null;
  }): Promise<SnapshotRef> {
    const row = await createSnapshotRow(this.service, input);
    return { id: row.id, ref: row.ref, status: row.status };
  }

  async setSnapshotStatus(id: string, status: CloudSnapshotRow["status"]): Promise<void> {
    await setSnapshotStatus(this.service, id, status);
  }

  async getSnapshot(id: string): Promise<SnapshotRef | null> {
    const { data, error } = await this.service
      .from("cloud_snapshots")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw supabaseErrorToAppError(error);
    if (!data) return null;
    return { id: data.id, ref: data.ref, status: data.status };
  }

  async createDeployment(input: {
    projectId: string;
    kind: "preview" | "production";
    ref: string;
    branch?: string | null;
    requestId?: string | null;
    initiatedBy?: string | null;
  }): Promise<{ id: string }> {
    const row = await createDeploymentRow(this.service, input);
    return { id: row.id };
  }

  async syncDeployment(id: string, result: { status: string; url?: string | null }): Promise<void> {
    await syncDeploymentResult(this.service, id, result as { status: "ready" | "failed" | "cancelled" | "queued" | "building"; url?: string | null });
  }

  async markDeploymentRolledBack(id: string): Promise<void> {
    await markDeploymentRolledBack(this.service, id);
  }
}

// ------------------------------------------------------------------
// In-memory store for tests
// ------------------------------------------------------------------

type MemoryRequest = Database["public"]["Tables"]["self_development_requests"]["Row"];
type MemoryStep = Database["public"]["Tables"]["self_development_steps"]["Row"];
type MemoryChange = Database["public"]["Tables"]["self_development_changes"]["Row"];

export class MemorySelfDevelopmentStore implements SelfDevelopmentStore {
  requests = new Map<string, MemoryRequest>();
  steps = new Map<string, MemoryStep>();
  changes = new Map<string, MemoryChange>();
  snapshots = new Map<string, SnapshotRef>();
  deployments = new Map<string, { id: string }>();
  projects = new Map<string, CloudProjectRow>();

  private now(): string {
    return new Date().toISOString();
  }

  constructor(seed?: { projects?: Record<string, CloudProjectRow> }) {
    if (seed?.projects) {
      for (const [id, project] of Object.entries(seed.projects)) this.projects.set(id, project);
    }
  }

  async createRequest(input: { projectId: string; requestedBy: string | null; prompt: string }): Promise<SelfDevelopmentRequestView> {
    const project = this.projects.get(input.projectId);
    if (!project) throw new NotFoundError("Project not found.");
    const request: MemoryRequest = {
      id: randomUUID(),
      project_id: input.projectId,
      requested_by: input.requestedBy,
      prompt: input.prompt,
      status: "draft",
      risk_level: "low",
      plan: null,
      review: null,
      branch: null,
      snapshot_id: null,
      deployment_id: null,
      approved_by: null,
      approved_at: null,
      plan_approved_by: null,
      plan_approved_at: null,
      error: null,
      started_at: null,
      completed_at: null,
      created_at: this.now(),
      updated_at: this.now(),
    };
    this.requests.set(request.id, request);
    return { request, project };
  }

  async getRequest(id: string): Promise<SelfDevelopmentRequestView | null> {
    const request = this.requests.get(id);
    if (!request) return null;
    const project = this.projects.get(request.project_id);
    if (!project) return null;
    return { request, project };
  }

  async updateRequest(id: string, patch: RequestPatch): Promise<void> {
    const request = this.requests.get(id);
    if (!request) return;
    this.requests.set(id, { ...request, ...patch, updated_at: this.now() });
  }

  async listRequests(): Promise<SelfDevelopmentRequestView[]> {
    const views: SelfDevelopmentRequestView[] = [];
    for (const request of [...this.requests.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
      const project = this.projects.get(request.project_id);
      if (project) views.push({ request, project });
    }
    return views;
  }

  async addStep(input: NewStepInput): Promise<MemoryStep> {
    const step: MemoryStep = {
      id: randomUUID(),
      request_id: input.requestId,
      stage: input.stage,
      status: input.status ?? "pending",
      operation_id: input.operationId ?? null,
      exit_code: null,
      duration_ms: null,
      output_head: "",
      output_truncated: false,
      error: null,
      step_order: input.stepOrder,
      started_at: this.now(),
      completed_at: null,
      created_at: this.now(),
    };
    this.steps.set(step.id, step);
    return step;
  }

  async updateStep(id: string, patch: StepPatch): Promise<void> {
    const step = this.steps.get(id);
    if (!step) return;
    this.steps.set(id, { ...step, ...patch });
  }

  async listSteps(requestId: string): Promise<MemoryStep[]> {
    return [...this.steps.values()]
      .filter((step) => step.request_id === requestId)
      .sort((a, b) => a.step_order - b.step_order);
  }

  async addChange(input: NewChangeInput): Promise<void> {
    const change: MemoryChange = {
      id: randomUUID(),
      request_id: input.requestId,
      file: input.file,
      operation: input.operation,
      path_from: input.pathFrom ?? null,
      path_to: input.pathTo ?? null,
      diff: input.diff,
      before_sha256: input.beforeSha256 ?? null,
      after_sha256: input.afterSha256 ?? null,
      created_at: this.now(),
    };
    this.changes.set(change.id, change);
  }

  async listChanges(requestId: string): Promise<MemoryChange[]> {
    return [...this.changes.values()].filter((change) => change.request_id === requestId);
  }

  async createSnapshot(input: { projectId: string; reason: string; ref: string; createdBy?: string | null }): Promise<SnapshotRef> {
    const snapshot: SnapshotRef = { id: randomUUID(), ref: input.ref, status: "created" };
    this.snapshots.set(snapshot.id, snapshot);
    return snapshot;
  }

  async setSnapshotStatus(id: string, status: CloudSnapshotRow["status"]): Promise<void> {
    const snapshot = this.snapshots.get(id);
    if (snapshot) this.snapshots.set(id, { ...snapshot, status });
  }

  async getSnapshot(id: string): Promise<SnapshotRef | null> {
    return this.snapshots.get(id) ?? null;
  }

  async createDeployment(): Promise<{ id: string }> {
    const deployment = { id: randomUUID() };
    this.deployments.set(deployment.id, deployment);
    return deployment;
  }

  async syncDeployment(id: string, result: { status: string; url?: string | null }): Promise<void> {
    void result;
  }

  async markDeploymentRolledBack(id: string): Promise<void> {
    void id;
  }
}