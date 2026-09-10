import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkerHandle } from "../../worker/src/server";
import { loadConfig } from "../../worker/src/config";
import { RemoteExecutionProvider } from "@/server/cloud/execution/providers";
import { RemoteGitProvider } from "@/server/cloud/git/providers";
import { getWorkspaceProvider, RemoteWorkspaceProvider } from "@/server/cloud/workspace/providers";
import { getGitProvider } from "@/server/cloud/git/providers";
import { remoteWorkspaceFileReader } from "@/server/cloud/deploy/providers";
import { CodeModificationProvider } from "@/server/self-development/modifier";
import { MemorySelfDevelopmentStore } from "@/server/self-development/store";
import { SelfDevelopmentOrchestrator, type OrchestratorConfig, type OrchestratorDeps } from "@/server/self-development/orchestrator";
import type { SelfDevelopmentAi } from "@/server/self-development/ai";
import type { SelfDevelopmentPlan, SelfDevelopmentReview } from "@/lib/supabase/database.types";
import type { CloudProjectRow } from "@/server/cloud/service";
import type {
  CloudExecutionProvider,
  CreatedDeployment,
  DeploymentProvider,
  ExecutionProviderStatus,
  ProcessSnapshot,
  RunOptions,
} from "@/server/cloud/types";
import type { CodeChangeOp } from "@/server/self-development/types";

const TEST_TOKEN = "test-token-123";
const PROJECT_A = "aaaaaa11-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_B = "bbbbbb22-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let worker: WorkerHandle | null = null;
let volume: string = "";
let baseUrl = "";

beforeAll(async () => {
  volume = fs.mkdtempSync(path.join(os.tmpdir(), "chatr-app-remote-"));
  const config = loadConfig({
    CLOUD_EXECUTION_WORKER_TOKEN: TEST_TOKEN,
    CLOUD_EXECUTION_WORKER_HOST: "127.0.0.1",
    CLOUD_EXECUTION_WORKER_PORT: "0",
    CLOUD_WORKER_WORKSPACE_ROOT: volume,
  });
  worker = new WorkerHandle({ ...config, port: 0 });
  await new Promise<void>((resolve) => worker!.server.listen(0, "127.0.0.1", resolve));
  const addr = worker!.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
  process.env.CLOUD_EXECUTION_WORKER_URL = baseUrl;
  process.env.CLOUD_EXECUTION_WORKER_TOKEN = TEST_TOKEN;
});

afterAll(() => {
  delete process.env.CLOUD_EXECUTION_WORKER_URL;
  delete process.env.CLOUD_EXECUTION_WORKER_TOKEN;
  worker?.shutdown();
  try {
    fs.rmSync(volume, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

const workspaceRemote = new RemoteWorkspaceProvider();
const gitRemote = new RemoteGitProvider();

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
  status(): ExecutionProviderStatus {
    return { configured: true, id: this.id, label: "Test execution", description: "Instant success." };
  }
  async run(options: RunOptions): Promise<ProcessSnapshot> {
    return {
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
  }
  poll(): never {
    throw new Error("not used");
  }
  async cancel(id: string): Promise<ProcessSnapshot> {
    return {
      id,
      program: "",
      args: [],
      state: "cancelled",
      exitCode: null,
      startedAt: Date.now(),
      finishedAt: null,
      durationMs: null,
      bytes: 0,
      truncated: false,
    };
  }
  list() {
    return [];
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

describe("Remote providers against an in-process worker", () => {
  it("selects remote workspace/git providers when the worker URL is configured", () => {
    expect(getWorkspaceProvider()).toBeInstanceOf(RemoteWorkspaceProvider);
    expect(getGitProvider()).toBeInstanceOf(RemoteGitProvider);
  });

  it("resolves roots as opaque project-id handles and refuses a bad id", () => {
    expect(workspaceRemote.resolveRoot(PROJECT_A)).toBe(PROJECT_A);
    expect(() => workspaceRemote.resolveRoot("not-a-uuid")).toThrow();
  });

  it("writes, reads, lists, searches, renames and deletes files remotely", async () => {
    const root = workspaceRemote.resolveRoot(PROJECT_A);
    await workspaceRemote.writeFile(root, "README.md", "hello remote\n");
    await workspaceRemote.writeFile(root, "src/index.ts", "export const a = 1;\n");
    await workspaceRemote.createDir(root, "docs");
    await workspaceRemote.writeFile(root, "docs/guide.md", "# Guide");

    const read = await workspaceRemote.readFile(root, "src/index.ts");
    expect(read.content).toContain("a = 1");

    const list = await workspaceRemote.listDir(root, ".", { depth: 3 });
    const names = list.map((e) => e.path);
    expect(names).toContain("README.md");
    expect(names).toContain("src/index.ts");
    expect(names).toContain("docs/guide.md");

    const found = await workspaceRemote.search(root, "guide");
    expect(found.map((e) => e.path)).toContain("docs/guide.md");

    await workspaceRemote.renamePath(root, "docs", "notes");
    await expect(workspaceRemote.readFile(root, "docs/guide.md")).rejects.toThrow();
    expect((await workspaceRemote.readFile(root, "notes/guide.md")).content).toContain("Guide");

    await workspaceRemote.deletePath(root, "notes", { recursive: true });
    await expect(workspaceRemote.readFile(root, "notes/guide.md")).rejects.toThrow();
  });

  it("refuses sensitive files and keeps one project isolated from another", async () => {
    const root = workspaceRemote.resolveRoot(PROJECT_A);
    await expect(workspaceRemote.writeFile(root, ".env", "SECRET=1")).rejects.toThrow();
    const otherRoot = workspaceRemote.resolveRoot(PROJECT_B);
    await expect(workspaceRemote.readFile(otherRoot, "README.md")).rejects.toThrow(); // B has nothing
  });

  it("runs commands in the project workspace via the project-id handle", async () => {
    const executionRemote = new RemoteExecutionProvider(baseUrl, TEST_TOKEN);
    const root = workspaceRemote.resolveRoot(PROJECT_B);
    await workspaceRemote.writeFile(
      root,
      "verify-cwd.js",
      'const fs = require("fs"); const base = require("path").basename(process.cwd());' +
        'fs.writeFileSync("cwd-report.txt", process.cwd()); if (base !== process.argv[2]) process.exit(1);'
    );
    const snapshot = await executionRemote.run({
      id: `exec-${randomUUID()}`,
      program: "node",
      args: ["verify-cwd.js", PROJECT_B],
      cwd: PROJECT_B, // the app passes the handle straight through (execute/pipeline routes)
      timeoutMs: 10_000,
      maxOutputBytes: 1024,
    });
    expect(snapshot.state).toBe("completed");
    expect(snapshot.exitCode).toBe(0);
    const report = await workspaceRemote.readFile(root, "cwd-report.txt");
    expect(report.content).toBe(path.resolve(volume, PROJECT_B));
  });

  it("reads deployable files through the remote workspace provider", async () => {
    const root = workspaceRemote.resolveRoot(PROJECT_A);
    await workspaceRemote.writeFile(root, "package.json", "{ \"name\": \"demo\" }\n");
    await workspaceRemote.writeFile(root, "public/logo.png", "not really a png...");
    // Files the worker refuses to write (sensitive) are created directly on the
    // volume; the reader must still skip them when walking remotely.
    fs.mkdirSync(path.join(volume, PROJECT_A, "node_modules", "x"), { recursive: true });
    fs.writeFileSync(path.join(volume, PROJECT_A, "node_modules", "x", "index.js"), "skip me\n");
    fs.writeFileSync(path.join(volume, PROJECT_A, ".env.production"), "SKIP=1\n");

    const reader = remoteWorkspaceFileReader(workspaceRemote);
    const files = await reader.readRootFiles(root);
    const names = files.map((f) => f.file);
    expect(names).toContain("package.json");
    expect(names).toContain("README.md");
    expect(names.some((n) => n.startsWith("node_modules/"))).toBe(false);
    expect(names.some((n) => n.startsWith(".env"))).toBe(false);
    expect(files.find((f) => f.file === "README.md")?.data).toContain("hello remote");
  });
});

describe("Self-development lifecycle over a remote worker (real git on the volume)", () => {
  it("plans, develops, commits before deploy, deploys, and rolls back", async () => {
    const project = seedProject(new Date().toISOString());
    const projectRoot = workspaceRemote.resolveRoot(project.id);
    const store = new MemorySelfDevelopmentStore({ projects: { [project.id]: project } });
    const audit: string[] = [];
    const ai = stubAi();
    const modifier = new CodeModificationProvider(workspaceRemote);
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
      workspace: workspaceRemote,
      execution: new InstantExecutionProvider(),
      git: gitRemote,
      deployment,
      ai,
      modifier,
      config,
      audit: async (action: string) => {
        audit.push(action);
      },
      fetchImpl: (async () => ({ status: 200 })) as unknown as typeof fetch,
    } satisfies OrchestratorDeps);

    // Seed the repository on the worker volume and make the first commit.
    await workspaceRemote.writeFile(projectRoot, "src/hello.ts", "export const greeting = 'hi';\n");
    await workspaceRemote.writeFile(projectRoot, "package.json", "{}\n");
    expect(await gitRemote.isGitRepo(projectRoot)).toBe(false);
    await gitRemote.init(projectRoot, "main");
    await gitRemote.stageAll(projectRoot);
    await gitRemote.commit(projectRoot, "seed");
    expect((await gitRemote.currentBranch(projectRoot)).branch).toBe("main");

    const created = await orchestrator.createRequest({
      projectId: project.id,
      requestedBy: "admin",
      prompt: "Change the greeting in the UI.",
    });
    await orchestrator.startPlanning(created.request.id);
    await orchestrator.approvePlan(created.request.id, "admin", { acknowledgeCritical: false });
    expect(await gitRemote.currentBranch(projectRoot)).toMatchObject({
      branch: `self-dev/${created.request.id.slice(0, 8)}`,
    });

    const ran = await orchestrator.runDevelopment(created.request.id);
    expect(ran.request.status).toBe("awaiting_deploy_approval");

    const steps = await store.listSteps(created.request.id);
    expect(steps.find((s) => s.stage === "commit")?.status).toBe("passed");

    // The commit-before-deploy gate must pass with a clean tree.
    await orchestrator.approveDeploy(created.request.id, "admin", { acknowledgeCritical: false });
    expect((await gitRemote.status(projectRoot)).clean).toBe(true);
    expect(deployment.deployCallCount).toBe(1);

    const rolled = await orchestrator.rollback(created.request.id, { confirm: true });
    expect(rolled.request.status).toBe("rolled_back");
    expect(deployment.deployCallCount).toBe(2);
    expect(audit).toContain("development_branch_committed");
    expect(audit).toContain("development_rolled_back");
  });
});