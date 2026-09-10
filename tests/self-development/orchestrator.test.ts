import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { LocalWorkspaceProvider } from "@/server/cloud/workspace/providers";
import { LocalGitProvider } from "@/server/cloud/git/providers";
import { CodeModificationProvider } from "@/server/self-development/modifier";
import { MemorySelfDevelopmentStore, type SelfDevelopmentStore } from "@/server/self-development/store";
import { SelfDevelopmentOrchestrator, type OrchestratorConfig, type OrchestratorDeps } from "@/server/self-development/orchestrator";
import type { SelfDevelopmentAi } from "@/server/self-development/ai";
import { ForbiddenError, ConflictError, ValidationError } from "@/server/errors";
import type { SelfDevelopmentPlan, SelfDevelopmentReview } from "@/lib/supabase/database.types";
import type { CloudProjectRow } from "@/server/cloud/service";
import type {
  CloudExecutionProvider,
  CreatedDeployment,
  DeploymentProvider,
  ExecutionProviderStatus,
  GitProvider,
  ProcessSnapshot,
  RunOptions,
} from "@/server/cloud/types";
import type { CodeChangeOp } from "@/server/self-development/types";

const workspace = new LocalWorkspaceProvider();
const modifier = new CodeModificationProvider(workspace);

function seedProject(now: string): CloudProjectRow {
  return {
    id: randomUUID(),
    name: "Demo App",
    slug: "demo-app",
    description: "",
    status: "active",
    repo_url: null,
    default_branch: "main",
    base_env: "production",
    last_build_status: "never",
    last_deployment_status: "never",
    env_vars: [],
    created_at: now,
    updated_at: now,
    last_activity_at: now,
  };
}

class InstantExecutionProvider implements CloudExecutionProvider {
  readonly id = "test-execution";
  private procs = new Map<string, ProcessSnapshot>();
  private buffers = new Map<string, Array<{ seq: number; kind: "stdout"; text: string }>>();

  status(): ExecutionProviderStatus {
    return { configured: true, id: this.id, label: "Test execution", description: "Instant success." };
  }

  async run(options: RunOptions) {
    const snapshot: ProcessSnapshot = {
      id: options.id,
      program: options.program,
      args: options.args,
      state: "completed",
      exitCode: 0,
      startedAt: Date.now(),
      finishedAt: Date.now(),
      durationMs: 1,
      bytes: 0,
      truncated: false,
    };
    this.procs.set(options.id, snapshot);
    this.buffers.set(options.id, [
      { seq: 0, kind: "stdout", text: `${options.program} ${options.args.join(" ")} ok` },
    ]);
    return snapshot;
  }

  poll(id: string, since: number) {
    const snapshot = this.procs.get(id);
    if (!snapshot) throw new Error("unknown process");
    return { snapshot, newOutput: (this.buffers.get(id) ?? []).filter((c) => c.seq > since) };
  }

  async cancel(id: string) {
    const last = this.procs.get(id);
    const snapshot: ProcessSnapshot = {
      id,
      program: last?.program ?? "",
      args: last?.args ?? [],
      state: "cancelled",
      exitCode: null,
      startedAt: last?.startedAt ?? Date.now(),
      finishedAt: Date.now(),
      durationMs: null,
      bytes: 0,
      truncated: false,
    };
    this.procs.set(id, snapshot);
    return snapshot;
  }

  list() {
    return [...this.procs.values()];
  }
}

class FakeGit implements GitProvider {
  readonly id = "test-git";
  head = "abc123";
  branch = "main";

  providerStatus(): ExecutionProviderStatus {
    return { configured: true, id: this.id, label: "Test git", description: "In-memory." };
  }

  async isGitRepo() {
    return true;
  }

  async status() {
    return { branch: this.branch, ahead: 0, behind: 0, clean: true, files: [] };
  }

  async diff() {
    return "";
  }

  async log() {
    return [];
  }

  async branches() {
    return [{ current: true, name: this.branch }];
  }

  async currentBranch() {
    return { branch: this.branch, head: this.head };
  }

  async createBranch(_root: string, name: string) {
    this.branch = name;
    return this.status();
  }

  async checkout(_root: string, ref: string) {
    this.head = ref;
    return this.status();
  }

  async commit() {
    return { ref: this.head, message: "" };
  }

  async stageAll() {}

  async init() {
    return this.status();
  }

  async pull() {
    return { ok: true, message: "" };
  }

  async push() {
    return { ok: true, message: "" };
  }
}

class FakeDeployment implements DeploymentProvider {
  readonly id = "test-deploy";
  deployCallCount = 0;

  status(): ExecutionProviderStatus {
    return { configured: true, id: this.id, label: "Test deploy", description: "In-memory." };
  }

  async createDeployment(): Promise<CreatedDeployment> {
    this.deployCallCount += 1;
    return { requestId: `req-${randomUUID()}`, status: "ready", url: "https://app.example.test" };
  }

  async getDeployment(): Promise<CreatedDeployment> {
    return { requestId: "", status: "ready", url: null };
  }

  async cancelDeployment() {}
}

function stubAi(): SelfDevelopmentAi {
  const plan: SelfDevelopmentPlan = {
    goal: "Change the greeting",
    currentArchitecture: "Single page app",
    affectedFiles: ["src/hello.ts"],
    affectedSystems: ["ui"],
    requiredChanges: "Update the greeting constant.",
    potentialRisks: "None",
    databaseChanges: "None",
    apiChanges: "None",
    uiChanges: "Greeting text",
    securityImpact: "None",
    testingStrategy: "Covered by the pipeline",
    deploymentImpact: "Low",
    rollbackStrategy: "Restore the pre-change snapshot",
  };
  return {
    async buildPlan() {
      return plan;
    },
    async planCodeChanges(): Promise<CodeChangeOp[]> {
      return [{ op: "edit", path: "src/hello.ts", content: "export const greeting = 'bonjour';\n" }];
    },
    async fixBuildFailure(): Promise<CodeChangeOp[]> {
      return [{ op: "edit", path: "src/hello.ts", content: "export const greeting = 'bonjour';\n" }];
    },
    async reviewChanges(): Promise<SelfDevelopmentReview> {
      return {
        result: "approved",
        summary: "Matches the approved plan.",
        security: "No change in security.",
        correctness: "Correct.",
        architecture: "Consistent.",
        regressionRisk: "Low.",
        performance: "Neutral.",
        codeQuality: "Good.",
        tests: "Covered.",
        databaseImpact: "None.",
        authImpact: "None.",
        deploymentImpact: "Low.",
        reviewedAt: new Date().toISOString(),
      };
    },
  } as unknown as SelfDevelopmentAi;
}

interface Rig {
  orchestrator: SelfDevelopmentOrchestrator;
  store: SelfDevelopmentStore;
  project: CloudProjectRow;
  audit: string[];
  ai: SelfDevelopmentAi;
}

function makeRig(overrides?: { allowProductionSelfModification?: boolean }): Rig {
  const project = seedProject(new Date().toISOString());
  const store = new MemorySelfDevelopmentStore({ projects: { [project.id]: project } });
  const audit: string[] = [];
  const ai = stubAi();
  const config: OrchestratorConfig = {
    allowProductionSelfModification: overrides?.allowProductionSelfModification ?? true,
    maxRepairAttempts: 2,
    timeoutMs: 60_000,
    maxFilesChanged: 10,
    appBaseUrl: "https://app.example.test",
  };
  const orchestrator = new SelfDevelopmentOrchestrator({
    store,
    workspace,
    execution: new InstantExecutionProvider(),
    git: new FakeGit(),
    deployment: new FakeDeployment(),
    ai,
    modifier,
    config,
    audit: async (action: string) => {
      audit.push(action);
    },
    fetchImpl: (async () => ({ status: 200 })) as unknown as typeof fetch,
  } satisfies OrchestratorDeps);
  return { orchestrator, store, project, audit, ai };
}

async function seedFiles(project: CloudProjectRow) {
  const root = workspace.resolveRoot(project.id);
  await workspace.writeFile(root, "src/hello.ts", "export const greeting = 'hi';\n");
  await workspace.writeFile(root, "package.json", "{}\n");
}

describe("SelfDevelopmentOrchestrator supervised happy path", () => {
  it("plans, snapshots, develops, validates, reviews, deploys, then rolls back", async () => {
    const { orchestrator, store, project, audit } = makeRig();
    await seedFiles(project);

    const created = await orchestrator.createRequest({
      projectId: project.id,
      requestedBy: "admin",
      prompt: "Add a landing page section in the UI and change the greeting.",
    });
    expect(created.request.status).toBe("draft");

    const planned = await orchestrator.startPlanning(created.request.id);
    expect(planned.request.status).toBe("awaiting_plan_approval");
    expect(planned.request.risk_level).toBe("low");
    expect(planned.request.plan?.goal).toBeTruthy();

    const approved = await orchestrator.approvePlan(created.request.id, "admin", { acknowledgeCritical: false });
    expect(approved.request.status).toBe("workspace_preparing");
    expect(approved.request.snapshot_id).toBeTruthy();
    expect(approved.request.branch).toBe(`self-dev/${created.request.id.slice(0, 8)}`);

    const ran = await orchestrator.runDevelopment(created.request.id);
    expect(ran.request.status).toBe("awaiting_deploy_approval");
    expect(ran.request.review?.result).toBe("approved");

    const changes = await store.listChanges(created.request.id);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0].operation).toBe("edit");

    const steps = await store.listSteps(created.request.id);
    for (const required of ["lint", "typecheck", "test", "gate", "build"]) {
      expect(steps.some((s) => s.stage === required && s.status === "passed"), required).toBe(true);
    }

    const deployed = await orchestrator.approveDeploy(created.request.id, "admin", { acknowledgeCritical: false });
    expect(deployed.request.status).toBe("completed");
    expect(deployed.request.deployment_id).toBeTruthy();
    const finalSteps = await store.listSteps(created.request.id);
    expect(finalSteps.some((s) => s.stage === "verify" && s.status === "passed")).toBe(true);

    const rolled = await orchestrator.rollback(created.request.id, { confirm: true });
    expect(rolled.request.status).toBe("rolled_back");

    expect(audit).toContain("development_request_created");
    expect(audit).toContain("development_deployment_completed");
    expect(audit).toContain("development_rolled_back");
  });

  it("requires an acknowledgment to approve a critical-risk plan", async () => {
    const { orchestrator, project } = makeRig();
    await seedFiles(project);
    const created = await orchestrator.createRequest({
      projectId: project.id,
      requestedBy: "admin",
      prompt: "Change the super admin authorization checks.",
    });
    expect(created.request.risk_level).toBe("low");

    const planned = await orchestrator.startPlanning(created.request.id);
    expect(planned.request.risk_level).toBe("critical");

    await expect(
      orchestrator.approvePlan(created.request.id, "admin", { acknowledgeCritical: false })
    ).rejects.toThrow(ForbiddenError);
  });

  it("blocks deploy approval when production self-modification is disabled", async () => {
    const { orchestrator, store, project } = makeRig({ allowProductionSelfModification: false });
    const created = await orchestrator.createRequest({
      projectId: project.id,
      requestedBy: "admin",
      prompt: "Add a component in the UI.",
    });
    await store.updateRequest(created.request.id, {
      status: "awaiting_deploy_approval",
      branch: "self-dev/x",
      snapshot_id: "snap-1",
      review: {
        result: "approved",
        summary: "ok",
        security: "",
        correctness: "",
        architecture: "",
        regressionRisk: "",
        performance: "",
        codeQuality: "",
        tests: "",
        databaseImpact: "",
        authImpact: "",
        deploymentImpact: "",
        reviewedAt: new Date().toISOString(),
      },
    });
    let order = 0;
    for (const required of ["lint", "typecheck", "test", "build"]) {
      await store.addStep({ requestId: created.request.id, stage: required, status: "passed", stepOrder: order++ });
    }

    await expect(
      orchestrator.approveDeploy(created.request.id, "admin", { acknowledgeCritical: false })
    ).rejects.toThrow(ConflictError);
  });

  it("cancels an active request and refuses a second cancel", async () => {
    const { orchestrator, project } = makeRig();
    await seedFiles(project);
    const created = await orchestrator.createRequest({
      projectId: project.id,
      requestedBy: "admin",
      prompt: "Add a component to the UI.",
    });
    await orchestrator.startPlanning(created.request.id);
    const cancelled = await orchestrator.cancel(created.request.id);
    expect(cancelled.request.status).toBe("cancelled");

    await expect(orchestrator.cancel(created.request.id)).rejects.toThrow(ConflictError);
  });

  it("requires explicit confirmation before rolling back", async () => {
    const { orchestrator, store, project } = makeRig();
    await seedFiles(project);
    const created = await orchestrator.createRequest({
      projectId: project.id,
      requestedBy: "admin",
      prompt: "Add a button in the UI.",
    });
    await orchestrator.startPlanning(created.request.id);
    await orchestrator.approvePlan(created.request.id, "admin", { acknowledgeCritical: false });
    await orchestrator.runDevelopment(created.request.id);
    await orchestrator.approveDeploy(created.request.id, "admin", { acknowledgeCritical: false });

    await expect(orchestrator.rollback(created.request.id, { confirm: false })).rejects.toThrow(ValidationError);

    store.markDeploymentRolledBack = async () => {};
    const rolled = await orchestrator.rollback(created.request.id, { confirm: true });
    expect(rolled.request.status).toBe("rolled_back");
  });
});

describe("SelfDevelopmentOrchestrator over a real git repository", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
      try {
        cleanup();
      } catch {
        // best effort
      }
    }
  });

  function git(root: string, ...args: string[]) {
    execFileSync("git", args, { cwd: root, encoding: "utf8" });
  }

  async function makeGitRig() {
    const project = seedProject(new Date().toISOString());
    const root = workspace.resolveRoot(project.id);
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
    const store = new MemorySelfDevelopmentStore({ projects: { [project.id]: project } });
    const audit: string[] = [];
    const ai = stubAi();
    const gitProvider = new LocalGitProvider();
    const deployment = new FakeDeployment();
    const config: OrchestratorConfig = {
      allowProductionSelfModification: true,
      maxRepairAttempts: 2,
      timeoutMs: 60_000,
      maxFilesChanged: 10,
      appBaseUrl: "https://app.example.test",
    };
    const orchestrator = new SelfDevelopmentOrchestrator({
      store,
      workspace,
      execution: new InstantExecutionProvider(),
      git: gitProvider,
      deployment,
      ai,
      modifier,
      config,
      audit: async (action: string) => {
        audit.push(action);
      },
      fetchImpl: (async () => ({ status: 200 })) as unknown as typeof fetch,
    } satisfies OrchestratorDeps);

    git(root, "init", "-b", "main");
    git(root, "config", "user.name", "Cloud Test");
    git(root, "config", "user.email", "cloud-test@chatr.local");
    await workspace.writeFile(root, "src/hello.ts", "export const greeting = 'hi';\n");
    await workspace.writeFile(root, "package.json", "{}\n");
    git(root, "add", ".");
    git(root, "commit", "-m", "seed");

    return { orchestrator, store, project, audit, gitProvider, deployment, root };
  }

  it("commits the development branch before the deploy gate, then redeploys the restored code on rollback", async () => {
    const { orchestrator, store, project, audit, gitProvider, deployment, root } = await makeGitRig();

    const created = await orchestrator.createRequest({
      projectId: project.id,
      requestedBy: "admin",
      prompt: "Change the greeting in the UI.",
    });
    await orchestrator.startPlanning(created.request.id);
    await orchestrator.approvePlan(created.request.id, "admin", { acknowledgeCritical: false });
    expect(await gitProvider.currentBranch(root)).toMatchObject({
      branch: `self-dev/${created.request.id.slice(0, 8)}`,
    });

    const ran = await orchestrator.runDevelopment(created.request.id);
    expect(ran.request.status).toBe("awaiting_deploy_approval");

    const steps = await store.listSteps(created.request.id);
    const commitStep = steps.find((s) => s.stage === "commit");
    expect(commitStep?.status).toBe("passed");

    // Previously the modified-but-uncommitted tree made approveDeploy reject
    // with ConflictError; the commit step makes the deploy gate pass.
    await orchestrator.approveDeploy(created.request.id, "admin", { acknowledgeCritical: false });
    const status = await gitProvider.status(root);
    expect(status.clean).toBe(true);
    expect(deployment.deployCallCount).toBe(1);

    const rolled = await orchestrator.rollback(created.request.id, { confirm: true });
    expect(rolled.request.status).toBe("rolled_back");
    expect(deployment.deployCallCount).toBe(2);

    const restoredHead = await gitProvider.currentBranch(root);
    expect(restoredHead.head).toBeTruthy();
    expect(audit).toContain("development_branch_committed");
    expect(audit).toContain("development_rolled_back");
  });
});