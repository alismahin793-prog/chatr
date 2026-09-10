import { randomUUID } from "node:crypto";
import {
  CLOUD_PIPELINE_STEPS,
  type CloudExecutionProvider,
  type DeploymentProvider,
  type GitProvider,
  type ProcessSnapshot,
  type ProcessState,
  type WorkspaceProvider,
} from "@/server/cloud/types";
import { isSensitivePath } from "@/server/cloud/paths";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/errors";
import { redactSecretContent } from "./diff";
import { assertTransition, isTerminal } from "./lifecycle";
import { classifyRisk } from "./risk";
import { SelfDevelopmentAi, aiErrorMessage } from "./ai";
import { CodeModificationProvider } from "./modifier";
import type { SelfDevelopmentStore, SelfDevelopmentRequestView } from "./store";
import type { CodeChangeOp } from "./types";
import type {
  SelfDevelopmentPlan,
  SelfDevelopmentRequestStatus,
  SelfDevelopmentReview,
} from "@/lib/supabase/database.types";

/**
 * SelfDevelopmentOrchestrator — the supervised state machine that turns a
 * Super Admin's feature request into a reviewed, approved, deployed feature.
 *
 * Safety invariants enforced here (never relaxed by the caller):
 * - AI only ever proposes; files change through CodeModificationProvider on an
 *   isolated branch/workspace, never in production and never via a shell.
 * - Progress follows the lifecycle (see lifecycle.ts); humans approve the
 *   plan and the deployment; critical-risk requests need explicit confirmation
 *   at both gates.
 * - Validation reuses CLOUD_PIPELINE_STEPS with a bounded repair loop
 *   (MAX_REPAIR_ATTEMPTS) and a hard timeout — no unbounded work.
 * - Deployment requires the checklist to pass; verification hits /api/health
 *   on env/provider-supplied base URLs only (never user input); rollback
 *   restores the pre-change snapshot after explicit confirmation.
 */

export interface OrchestratorConfig {
  allowProductionSelfModification: boolean;
  maxRepairAttempts: number;
  timeoutMs: number;
  maxFilesChanged: number;
  /** Trusted base URL for post-deploy health checks (env, never user input). */
  appBaseUrl?: string;
}

export interface OrchestratorDeps {
  store: SelfDevelopmentStore;
  workspace: WorkspaceProvider;
  execution: CloudExecutionProvider;
  git: GitProvider;
  deployment: DeploymentProvider;
  ai: SelfDevelopmentAi;
  modifier: CodeModificationProvider;
  config: OrchestratorConfig;
  audit: (action: string, meta?: Record<string, unknown>) => Promise<void>;
  fetchImpl?: typeof fetch;
}

const TERMINAL_PROCESS_STATES: readonly ProcessState[] = ["completed", "cancelled", "timed_out", "error"];
const MAX_OUTPUT_HEAD = 4000;
const IGNORED_TREE_SEGMENTS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "coverage",
  ".vercel",
]);

export class SelfDevelopmentOrchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  // --------------------------------------------------------------
  // Creation
  // --------------------------------------------------------------

  async createRequest(input: {
    projectId: string;
    requestedBy: string | null;
    prompt: string;
  }): Promise<SelfDevelopmentRequestView> {
    const view = await this.deps.store.createRequest(input);
    await this.deps.audit("development_request_created", {
      requestId: view.request.id,
      projectId: input.projectId,
    });
    return view;
  }

  // --------------------------------------------------------------
  // Planning
  // --------------------------------------------------------------

  async startPlanning(id: string): Promise<SelfDevelopmentRequestView> {
    const view = await this.getView(id);
    assertTransition(view.request.status, "planning");
    await this.patch(id, { status: "planning", started_at: this.now(), error: null });
    const step = await this.addRunningStep(id, "planning");
    try {
      const overview = await this.projectOverview(view);
      const plan = await this.deps.ai.buildPlan({ prompt: view.request.prompt, projectOverview: overview });
      const risk = classifyRisk({ prompt: view.request.prompt, affectedFiles: plan.affectedFiles });
      await this.patch(id, { plan, risk_level: risk.level, status: "awaiting_plan_approval" });
      await this.markStep(step.id, "passed", plan.goal);
      await this.deps.audit("development_plan_created", {
        requestId: id,
        riskLevel: risk.level,
      });
    } catch (error) {
      const message = aiErrorMessage(error);
      await this.markStep(step.id, "failed", message);
      await this.patch(id, { status: "failed", error: message });
      await this.deps.audit("development_failed", { requestId: id, step: "planning" });
    }
    return this.getView(id);
  }

  // --------------------------------------------------------------
  // Plan approval -> snapshot + isolated workspace
  // --------------------------------------------------------------

  async approvePlan(id: string, actorId: string, input: { acknowledgeCritical: boolean }): Promise<SelfDevelopmentRequestView> {
    const view = await this.getView(id);
    assertTransition(view.request.status, "snapshotting");
    if (view.request.risk_level === "critical" && !input.acknowledgeCritical) {
      throw new ForbiddenError(
        "This request carries critical risk and needs explicit acknowledgment before it can proceed."
      );
    }
    if (!view.request.plan) throw new ConflictError("This request has no approved plan to develop.");

    await this.patch(id, { status: "snapshotting" });
    const snapshotStep = await this.addRunningStep(id, "snapshot");
    try {
      const root = this.deps.workspace.resolveRoot(view.project.id);
      const head = await this.deps.git.currentBranch(root);
      if (!head.head) throw new ConflictError("The repository has no commit to snapshot yet.");
      const snapshot = await this.deps.store.createSnapshot({
        projectId: view.project.id,
        reason: `Self-development plan approval: ${view.request.prompt.slice(0, 120)}`,
        ref: head.head,
        createdBy: actorId,
      });
      await this.patch(id, { snapshot_id: snapshot.id });
      await this.markStep(snapshotStep.id, "passed", `Snapshot ${snapshot.id.slice(0, 8)} @ ${head.head.slice(0, 7)}`);
      await this.deps.audit("development_plan_approved", {
        requestId: id,
        riskLevel: view.request.risk_level,
        snapshotId: snapshot.id,
      });

      await this.patch(id, { status: "workspace_preparing" });
      const workspaceStep = await this.addRunningStep(id, "workspace");
      const branch = `self-dev/${id.slice(0, 8)}`;
      await this.deps.git.createBranch(root, branch);
      await this.patch(id, {
        branch,
        plan_approved_by: actorId,
        plan_approved_at: this.now(),
      });
      await this.markStep(workspaceStep.id, "passed", `Isolated branch ${branch}`);
      await this.deps.audit("development_workspace_ready", { requestId: id, branch });
    } catch (error) {
      const message = this.errorMessage(error);
      await this.markStep(snapshotStep.id, "failed", message);
      await this.patch(id, { status: "failed", error: message });
      await this.deps.audit("development_failed", { requestId: id, step: "snapshot" });
    }
    return this.getView(id);
  }

  async rejectPlan(id: string): Promise<SelfDevelopmentRequestView> {
    const view = await this.getView(id);
    assertTransition(view.request.status, "rejected");
    await this.patch(id, { status: "rejected", completed_at: this.now() });
    await this.deps.audit("development_plan_rejected", { requestId: id });
    return this.getView(id);
  }

  // --------------------------------------------------------------
  // Development run: analyze -> modify -> validate -> repair -> review
  // --------------------------------------------------------------

  async runDevelopment(id: string): Promise<SelfDevelopmentRequestView> {
    const view = await this.getView(id);
    assertTransition(view.request.status, "analyzing");
    await this.patch(id, { status: "analyzing" });
    const root = this.deps.workspace.resolveRoot(view.project.id);
    const deadline = Date.now() + this.deps.config.timeoutMs;
    let budget = this.deps.config.maxRepairAttempts;

    const analyzeStep = await this.addRunningStep(id, "analyze");
    let ops: CodeChangeOp[];
    try {
      const fileTree = await this.listContextTree(root);
      const snippets = await this.deps.modifier.readContextFiles(root, [
        ...(view.request.plan?.affectedFiles ?? []),
        "package.json",
      ]);
      ops = await this.deps.ai.planCodeChanges({
        plan: this.requirePlan(view),
        fileTree,
        snippets,
      });
      if (ops.length === 0) throw new AppError("unavailable", "The AI proposed no code changes.");
      if (ops.length > this.deps.config.maxFilesChanged) {
        throw new AppError(
          "unavailable",
          `The AI proposed ${ops.length} file changes (limit ${this.deps.config.maxFilesChanged}).`
        );
      }
      await this.markStep(analyzeStep.id, "passed", `Proposed ${ops.length} structured change(s).`);
      await this.patch(id, { status: "modifying" });
      await this.deps.audit("development_started", { requestId: id, changes: ops.length });
    } catch (error) {
      await this.failDevelopment(id, analyzeStep.id, error, "analyze");
      return this.getView(id);
    }

    let review: SelfDevelopmentReview | null = null;
    for (;;) {
      if (Date.now() > deadline) {
        await this.patch(id, { status: "failed", error: "Development run exceeded its timeout." });
        await this.deps.audit("development_failed", { requestId: id, step: "timeout" });
        return this.getView(id);
      }

      // Apply structured changes on the isolated branch.
      const modifyStep = await this.addRunningStep(id, "modify");
      try {
        const result = await this.deps.modifier.apply(root, ops);
        for (const change of result.applied) {
          await this.deps.store.addChange({
            requestId: id,
            file: change.file,
            operation: change.operation,
            pathFrom: change.pathFrom ?? null,
            pathTo: change.pathTo ?? null,
            diff: change.diff,
            beforeSha256: change.beforeSha256,
            afterSha256: change.afterSha256,
          });
        }
        const skipNote =
          result.skipped.length > 0
            ? ` (skipped: ${result.skipped.map((s) => `${s.file} — ${s.reason}`).join("; ")})`
            : "";
        await this.markStep(modifyStep.id, "passed", `Applied ${result.applied.length} change(s).${skipNote}`);
        await this.deps.audit("development_changes_applied", {
          requestId: id,
          applied: result.applied.length,
          skipped: result.skipped.length,
        });
      } catch (error) {
        await this.failDevelopment(id, modifyStep.id, error, "modify");
        return this.getView(id);
      }

      // Validation pipeline (reuses CLOUD_PIPELINE_STEPS) with a bounded repair loop.
      const pipeline = await this.runPipeline(id, root, deadline);
      if (!pipeline.ok) {
        await this.deps.audit("development_validation_failed", { requestId: id, step: pipeline.step });
        if (budget <= 0) {
          await this.patch(id, { status: "failed", error: pipeline.error ?? "Validation failed." });
          await this.deps.audit("development_failed", { requestId: id, step: pipeline.step });
          return this.getView(id);
        }
        budget--;
        const repairStep = await this.addRunningStep(id, "repair");
        try {
          const fileTree = await this.listContextTree(root);
          const snippets = await this.deps.modifier.readContextFiles(root, [
            ...(this.requirePlan(view).affectedFiles ?? []),
            "package.json",
          ]);
          ops = await this.deps.ai.fixBuildFailure({
            plan: this.requirePlan(view),
            fileTree,
            validationFailures: [pipeline.outputHead ?? pipeline.error ?? ""].filter(Boolean),
            snippets,
          });
          await this.markStep(repairStep.id, "passed", `Repair proposed ${ops.length} change(s).`);
          await this.patch(id, { status: "modifying" });
          await this.deps.audit("development_repair", {
            requestId: id,
            remaining: budget,
            step: pipeline.step,
          });
          continue;
        } catch (error) {
          await this.failDevelopment(id, repairStep.id, error, "repair");
          return this.getView(id);
        }
      }

      // AI review at the end of a green pipeline.
      const reviewStep = await this.addRunningStep(id, "review");
      try {
        const fileTree = await this.listContextTree(root);
        const snippets = await this.deps.modifier.readContextFiles(root, [
          ...(this.requirePlan(view).affectedFiles ?? []),
          "package.json",
        ]);
        review = await this.deps.ai.reviewChanges({
          projectName: view.project.name,
          fileTree,
          plan: this.requirePlan(view),
          validationFailures: [],
          snippets,
        });
        await this.patch(id, { review });
        await this.deps.audit("development_review_completed", { requestId: id, result: review.result });

        if (review.result === "blocked") {
          await this.markStep(reviewStep.id, "failed", "AI review blocked the change.");
          await this.patch(id, { status: "failed", error: "AI review blocked the change." });
          await this.deps.audit("development_failed", { requestId: id, step: "review" });
          return this.getView(id);
        }
        if (review.result === "needs_changes") {
          await this.markStep(reviewStep.id, "passed", "Review requires further changes.");
          if (budget <= 0) {
            await this.patch(id, {
              status: "failed",
              error: "Review requires changes but the repair budget is exhausted.",
            });
            await this.deps.audit("development_failed", { requestId: id, step: "review" });
            return this.getView(id);
          }
          budget--;
          await this.patch(id, { status: "modifying" });
          try {
            const fileTree = await this.listContextTree(root);
            const snippets = await this.deps.modifier.readContextFiles(root, [
              ...(this.requirePlan(view).affectedFiles ?? []),
              "package.json",
            ]);
            ops = await this.deps.ai.fixBuildFailure({
              plan: this.requirePlan(view),
              fileTree,
              validationFailures: [`Reviewer: ${review.summary}`],
              snippets,
            });
            await this.deps.audit("development_repair", { requestId: id, remaining: budget, step: "review" });
            continue;
          } catch (error) {
            await this.failDevelopment(id, reviewStep.id, error, "review");
            return this.getView(id);
          }
        }
        await this.markStep(reviewStep.id, "passed", review.summary);
        break;
      } catch (error) {
        await this.failDevelopment(id, reviewStep.id, error, "review");
        return this.getView(id);
      }
    }

    // The development branch must be committed before the deploy gate. The
    // deploy safety checklist (and the git provider) refuse to work against a
    // dirty tree, and only committed code is a certified, deployable state.
    // Push is best-effort (the uploaded payload is the workspace itself, so a
    // missing remote/upstream never blocks deployment).
    const commitStep = await this.addRunningStep(id, "commit");
    try {
      const commitMessage = this.commitMessageFor(id, view.request.prompt);
      await this.deps.git.stageAll(root);
      const committed = await this.deps.git.commit(root, commitMessage);
      const pushed = await this.deps.git.push(root).catch(() => ({ ok: false, message: "Push could not be checked." }));
      await this.markStep(
        commitStep.id,
        "passed",
        pushed.ok
          ? `Committed ${committed.ref.slice(0, 7)} and pushed the development branch.`
          : `Committed ${committed.ref.slice(0, 7)}. Push skipped: ${pushed.message.slice(0, 160)}`
      );
      await this.deps.audit("development_branch_committed", {
        requestId: id,
        ref: committed.ref,
        pushed: pushed.ok,
      });
    } catch (error) {
      await this.failDevelopment(id, commitStep.id, error, "commit");
      return this.getView(id);
    }

    await this.patch(id, { status: "awaiting_deploy_approval", review });
    return this.getView(id);
  }

  // --------------------------------------------------------------
  // Deploy approval -> deploy -> verify
  // --------------------------------------------------------------

  async approveDeploy(
    id: string,
    actorId: string,
    input: { acknowledgeCritical: boolean }
  ): Promise<SelfDevelopmentRequestView> {
    const view = await this.getView(id);
    assertTransition(view.request.status, "deploying");
    if (view.request.risk_level === "critical" && !input.acknowledgeCritical) {
      throw new ForbiddenError(
        "This request carries critical risk and needs explicit acknowledgment before deployment."
      );
    }

    const failures = await this.deploySafetyChecklist(view);
    if (failures.length > 0) {
      throw new ConflictError(`Deployment blocked by the safety checklist:\n- ${failures.join("\n- ")}`);
    }

    const root = this.deps.workspace.resolveRoot(view.project.id);
    await this.patch(id, { status: "deploying" });
    const deployStep = await this.addRunningStep(id, "deploy");
    try {
      const git = await this.deps.git.status(root);
      if (!git.clean) throw new ConflictError("The workspace has uncommitted changes; commit or revert before deploying.");
      const head = await this.deps.git.currentBranch(root);
      const created = await this.deps.deployment.createDeployment({
        projectId: view.project.id,
        ref: head.head,
        branch: view.request.branch ?? "main",
        workspaceRoot: root,
        kind: "production",
      });
      const deployment = await this.deps.store.createDeployment({
        projectId: view.project.id,
        kind: "production",
        ref: head.head,
        branch: view.request.branch ?? "main",
        requestId: id,
        initiatedBy: actorId,
      });
      await this.patch(id, {
        deployment_id: deployment.id,
        approved_by: actorId,
        approved_at: this.now(),
      });
      await this.markStep(deployStep.id, "passed", `Deploy ${created.requestId}${created.url ? ` → ${created.url}` : ""}`);
      await this.deps.audit("development_deployment_started", { requestId: id, deploymentId: deployment.id });

      await this.patch(id, { status: "verifying" });
      const verifyStep = await this.addRunningStep(id, "verify");
      const baseUrl: string | null = created.url ?? this.deps.config.appBaseUrl ?? null;
      const healthy = await this.verifyHealth(baseUrl);
      if (!healthy) {
        await this.markStep(verifyStep.id, "failed", "Post-deploy /api/health check did not pass.");
        await this.deps.store.syncDeployment(deployment.id, { status: "failed" });
        await this.patch(id, { status: "failed", error: "Post-deploy /api/health check did not pass." });
        await this.deps.audit("development_deployment_failed", { requestId: id });
        return this.getView(id);
      }
      await this.markStep(verifyStep.id, "passed", "Production /api/health is reachable.");
      await this.deps.store.syncDeployment(deployment.id, { status: "ready", url: created.url });
      await this.patch(id, { status: "completed", completed_at: this.now() });
      await this.deps.audit("development_deployment_completed", { requestId: id, deploymentId: deployment.id });
    } catch (error) {
      const message = this.errorMessage(error);
      await this.markStep(deployStep.id, "failed", message);
      await this.patch(id, { status: "failed", error: message });
      await this.deps.audit("development_deployment_failed", { requestId: id });
    }
    return this.getView(id);
  }

  // --------------------------------------------------------------
  // Cancellation / rollback
  // --------------------------------------------------------------

  async cancel(id: string): Promise<SelfDevelopmentRequestView> {
    const view = await this.getView(id);
    if (isTerminal(view.request.status)) {
      throw new ConflictError("This request has already finished.");
    }
    const steps = await this.deps.store.listSteps(id);
    for (const step of steps) {
      if (step.status === "pending" || step.status === "running") {
        await this.deps.store.updateStep(step.id, { status: "cancelled", completed_at: this.now() });
      }
    }
    const cancelStep = await this.addRunningStep(id, "cancel");
    await this.markStep(cancelStep.id, "passed", "Cancelled by an administrator.");
    await this.patch(id, { status: "cancelled", completed_at: this.now() });
    await this.deps.audit("development_cancelled", { requestId: id });
    return this.getView(id);
  }

  async rollback(id: string, input: { confirm: boolean }): Promise<SelfDevelopmentRequestView> {
    const view = await this.getView(id);
    if (!input.confirm) {
      throw new ValidationError("Rollback requires explicit confirmation.");
    }
    if (!view.request.snapshot_id) {
      throw new ConflictError("No pre-change snapshot exists to restore.");
    }
    assertTransition(view.request.status, "rolled_back");

    const snapshot = await this.deps.store.getSnapshot(view.request.snapshot_id);
    if (!snapshot) throw new NotFoundError("The pre-change snapshot no longer exists.");
    const root = this.deps.workspace.resolveRoot(view.project.id);

    const gitStatus = await this.deps.git.status(root);
    if (!gitStatus.clean) {
      throw new ConflictError("The workspace is dirty; commit or revert changes before restoring the snapshot.");
    }

    const rollbackStep = await this.addRunningStep(id, "rollback");
    try {
      await this.deps.store.setSnapshotStatus(snapshot.id, "restoring");
      await this.deps.git.checkout(root, snapshot.ref);
      await this.deps.store.setSnapshotStatus(snapshot.id, "restored");
      if (view.request.deployment_id) {
        await this.deps.store.markDeploymentRolledBack(view.request.deployment_id);
      }
      let restoredUrl: string | null = null;
      const deployStatus = this.deps.deployment.status();
      if (deployStatus.configured) {
        const head = await this.deps.git.currentBranch(root);
        const created = await this.deps.deployment.createDeployment({
          projectId: view.project.id,
          ref: head.head,
          branch: view.request.branch ?? "main",
          workspaceRoot: root,
          kind: "production",
        });
        const deployment = await this.deps.store.createDeployment({
          projectId: view.project.id,
          kind: "production",
          ref: head.head,
          branch: view.request.branch ?? "main",
          requestId: id,
        });
        await this.deps.store.syncDeployment(deployment.id, { status: created.status, url: created.url });
        restoredUrl = created.url;
      }
      await this.patch(id, { status: "rolled_back", completed_at: this.now() });
      await this.markStep(
        rollbackStep.id,
        "passed",
        deployStatus.configured
          ? `Restored ${snapshot.ref.slice(0, 7)} and redeployed the restored code${restoredUrl ? ` → ${restoredUrl}` : ""}.`
          : `Restored ${snapshot.ref.slice(0, 7)} in the workspace (deployment provider not configured; redeploy skipped).`
      );

      const verifyStep = await this.addRunningStep(id, "verify");
      const healthy = await this.verifyHealth(restoredUrl ?? this.deps.config.appBaseUrl ?? null);
      await this.markStep(
        verifyStep.id,
        healthy ? "passed" : "failed",
        healthy ? "Health re-check passed after rollback." : "Health re-check failed after rollback."
      );
      await this.deps.audit("development_rolled_back", { requestId: id, snapshotId: snapshot.id });
    } catch (error) {
      const message = this.errorMessage(error);
      await this.markStep(rollbackStep.id, "failed", message);
      await this.patch(id, { error: message });
      throw new ConflictError(`Rollback failed: ${message}`);
    }
    return this.getView(id);
  }

  // --------------------------------------------------------------
  // Validation pipeline + polling
  // --------------------------------------------------------------

  private async runPipeline(
    id: string,
    root: string,
    deadline: number
  ): Promise<{ ok: boolean; step?: string; error?: string; outputHead?: string }> {
    for (const stepDef of CLOUD_PIPELINE_STEPS) {
      if (Date.now() > deadline) {
        return { ok: false, step: stepDef.key, error: "Validation exceeded the development timeout." };
      }
      const statusFor: Record<string, SelfDevelopmentRequestStatus> = {
        install: "modifying",
        lint: "linting",
        typecheck: "typechecking",
        test: "testing",
        gate: "testing",
        build: "building",
      };
      const next = statusFor[stepDef.key];
      if (next) await this.patch(id, { status: next });

      const step = await this.addRunningStep(id, stepDef.key);
      const start = Date.now();
      const provider = this.deps.execution.status();
      if (!provider.configured) {
        const reason = provider.reason ?? "Execution provider is not configured.";
        await this.markStep(step.id, "failed", `Execution provider not configured: ${reason}`);
        await this.deps.audit("development_validation_failed", { requestId: id, step: stepDef.key });
        return { ok: false, step: stepDef.key, error: `Execution provider not configured: ${reason}` };
      }

      const runId = randomUUID();
      try {
        const initial = await this.deps.execution.run({
          id: runId,
          program: stepDef.program,
          args: stepDef.args,
          cwd: root,
          timeoutMs: stepDef.timeoutMs,
          maxOutputBytes: stepDef.maxOutputBytes,
        });
        const result = await this.awaitTerminal(runId, initial);
        const head = this.sanitizeOutput(result.output);
        const passed = result.exitCode === 0;
        await this.deps.store.updateStep(step.id, {
          status: passed ? "passed" : "failed",
          exit_code: result.exitCode,
          duration_ms: Date.now() - start,
          output_head: head,
          output_truncated: head.length >= MAX_OUTPUT_HEAD,
          operation_id: runId,
          completed_at: this.now(),
        });
        await this.deps.audit("development_validation_step", {
          requestId: id,
          step: stepDef.key,
          passed,
        });
        if (!passed) {
          return { ok: false, step: stepDef.key, outputHead: head, error: `${stepDef.label} failed` };
        }
      } catch (error) {
        const message = this.errorMessage(error);
        await this.markStep(step.id, "failed", message);
        await this.deps.audit("development_validation_failed", { requestId: id, step: stepDef.key });
        return { ok: false, step: stepDef.key, error: message };
      }
    }
    return { ok: true };
  }

  private async awaitTerminal(
    runId: string,
    initial: ProcessSnapshot
  ): Promise<{ output: string; exitCode: number | null }> {
    let last = initial;
    let since = 0;
    let output = "";
    for (;;) {
      let snapshot = last;
      try {
        const poll = this.deps.execution.poll(runId, since);
        snapshot = poll.snapshot;
        for (const chunk of poll.newOutput) {
          output += chunk.text;
          if (chunk.seq > since) since = chunk.seq;
        }
      } catch {
        snapshot = last;
      }
      last = snapshot;
      if (TERMINAL_PROCESS_STATES.includes(last.state)) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { output, exitCode: last.exitCode };
  }

  // --------------------------------------------------------------
  // Deployment safety checklist
  // --------------------------------------------------------------

  private async deploySafetyChecklist(view: SelfDevelopmentRequestView): Promise<string[]> {
    const request = view.request;
    const failures: string[] = [];
    if (!this.deps.config.allowProductionSelfModification) {
      failures.push(
        "Production self-modification is disabled (ALLOW_PRODUCTION_SELF_MODIFICATION=false). Deploy this branch manually through Cloud Deployments."
      );
    }
    if (!request.snapshot_id) failures.push("No pre-change snapshot exists.");
    if (!request.branch) failures.push("No development branch was prepared.");
    if (!request.review || request.review.result !== "approved") {
      failures.push("The AI review is not approved.");
    }
    const steps = await this.deps.store.listSteps(request.id);
    for (const required of ["lint", "typecheck", "test", "build"]) {
      if (!steps.some((step) => step.stage === required && step.status === "passed")) {
        failures.push(`Validation step "${required}" did not pass.`);
      }
    }
    const deploymentStatus = this.deps.deployment.status();
    if (!deploymentStatus.configured) {
      failures.push(
        `Deployment provider is not configured${
          deploymentStatus.reason ? `: ${deploymentStatus.reason}` : " (set VERCEL_TOKEN and VERCEL_PROJECT_ID)."
        }`
      );
    }
    return failures;
  }

  private async verifyHealth(baseUrl: string | null): Promise<boolean> {
    if (!baseUrl) return false;
    // baseUrl comes from the deployment provider result or env config — never
    // from user input, so this cannot be steered into an arbitrary host.
    const url = new URL("/api/health", baseUrl).toString();
    const fetchImpl = this.deps.fetchImpl ?? globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetchImpl(url, { signal: controller.signal, cache: "no-store" });
      return response.status === 200;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  // --------------------------------------------------------------
  // Context helpers
  // --------------------------------------------------------------

  private async projectOverview(view: SelfDevelopmentRequestView): Promise<string> {
    const root = this.deps.workspace.resolveRoot(view.project.id);
    const tree = await this.listContextTree(root);
    return `${view.project.name}\n${tree.join("\n")}`;
  }

  /** A bounded, sensitive-file-free file tree for AI context. */
  private async listContextTree(root: string): Promise<string[]> {
    const entries = await this.deps.workspace.listDir(root, ".", { depth: 2 });
    const tree: string[] = [];
    for (const entry of entries) {
      if (isSensitivePath(entry.path)) continue;
      const segments = entry.path.split("/");
      if (segments.some((segment) => IGNORED_TREE_SEGMENTS.has(segment))) continue;
      tree.push(entry.path);
      if (tree.length >= 400) break;
    }
    return tree;
  }

  // --------------------------------------------------------------
  // Small helpers
  // --------------------------------------------------------------

  private async getView(id: string): Promise<SelfDevelopmentRequestView> {
    const view = await this.deps.store.getRequest(id);
    if (!view) throw new NotFoundError("Self-development request not found.");
    return view;
  }

  private requirePlan(view: SelfDevelopmentRequestView): SelfDevelopmentPlan {
    if (!view.request.plan) throw new ConflictError("This request has no plan.");
    return view.request.plan;
  }

  private async patch(id: string, patch: Parameters<SelfDevelopmentStore["updateRequest"]>[1]): Promise<void> {
    await this.deps.store.updateRequest(id, patch);
  }

  private now(): string {
    return new Date().toISOString();
  }

  /** Compact, collision-safe, one-line commit message for a development branch. */
  private commitMessageFor(requestId: string, prompt: string): string {
    const summary = prompt.trim().replace(/\s+/g, " ").slice(0, 80);
    return `selfdev(${requestId.slice(0, 8)}): ${summary}`;
  }

  private errorMessage(error: unknown): string {
    if (error instanceof AppError) return error.message;
    if (error instanceof Error) return this.sanitizeOutput(error.message);
    return "Unexpected failure.";
  }

  private sanitizeOutput(text: string): string {
    const cleaned = text.replace(/\u0000/g, "").trim();
    return redactSecretContent(cleaned.slice(0, MAX_OUTPUT_HEAD));
  }

  private async addRunningStep(requestId: string, stage: string): Promise<{ id: string }> {
    const steps = await this.deps.store.listSteps(requestId);
    const step = await this.deps.store.addStep({
      requestId,
      stage,
      status: "running",
      stepOrder: steps.length,
    });
    return { id: step.id };
  }

  private async markStep(stepId: string, status: "passed" | "failed", outputHead: string): Promise<void> {
    await this.deps.store.updateStep(stepId, {
      status,
      output_head: this.sanitizeOutput(outputHead),
      output_truncated: outputHead.length >= MAX_OUTPUT_HEAD,
      completed_at: this.now(),
    });
  }

  private async failDevelopment(
    id: string,
    stepId: string,
    error: unknown,
    tag: string
  ): Promise<void> {
    const message = this.errorMessage(error);
    await this.markStep(stepId, "failed", message);
    await this.patch(id, { status: "failed", error: message });
    await this.deps.audit("development_failed", { requestId: id, step: tag });
  }
}