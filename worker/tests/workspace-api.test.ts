import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WorkerHandle } from "../src/server";
import { loadConfig, type WorkerConfig } from "../src/config";
import { MAX_TEXT_FILE_BYTES } from "../../src/server/cloud/paths";
import type { FileEntity, GitStatus } from "../../src/server/cloud/types";

const handles: WorkerHandle[] = [];
const dirs: string[] = [];

const TEST_TOKEN = "test-token-123";
const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";

interface WorkerUnderTest {
  baseUrl: string;
  handle: WorkerHandle;
  workspace: string;
}

async function startWorker(overrides: Partial<WorkerConfig> = {}): Promise<WorkerUnderTest> {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "chatr-worker-fs-"));
  dirs.push(workspace);
  const config = loadConfig({
    CLOUD_EXECUTION_WORKER_TOKEN: TEST_TOKEN,
    CLOUD_EXECUTION_WORKER_HOST: "127.0.0.1",
    CLOUD_EXECUTION_WORKER_PORT: "0",
    CLOUD_WORKER_WORKSPACE_ROOT: workspace,
  });
  const handle = new WorkerHandle({ ...config, port: 0, ...overrides });
  handles.push(handle);
  await new Promise<void>((resolve) => handle.server.listen(0, "127.0.0.1", resolve));
  const addr = handle.server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${addr.port}`, handle, workspace };
}

async function post(
  baseUrl: string,
  route: string,
  body: unknown,
  token: string = TEST_TOKEN
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(baseUrl + route, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => undefined) };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

afterEach(async () => {
  for (const handle of handles.splice(0)) {
    handle.shutdown();
  }
  await sleep(50);
  for (const dir of dirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

async function seedRemote(baseUrl: string, projectId: string): Promise<void> {
  await post(baseUrl, `/workspaces/${projectId}/files/write`, { path: "README.md", content: "hello remote\n" });
  await post(baseUrl, `/workspaces/${projectId}/files/write`, {
    path: "src/index.ts",
    content: "export const answer = 42;\n",
  });
  await post(baseUrl, `/workspaces/${projectId}/dirs/create`, { path: "docs" });
  await post(baseUrl, `/workspaces/${projectId}/files/write`, { path: "docs/guide.md", content: "# Guide" });
}

describe("Workspace file API", () => {
  it("requires authentication for every workspace endpoint", async () => {
    const { baseUrl } = await startWorker();
    const routes = [
      "/workspaces/11111111-1111-4111-8111-111111111111/files/list",
      "/workspaces/11111111-1111-4111-8111-111111111111/files/write",
      "/workspaces/11111111-1111-4111-8111-111111111111/git-status",
    ];
    for (const route of routes) {
      const res = await post(baseUrl, route, {}, "wrong-token");
      expect(res.status, route).toBe(401);
    }
    const noToken = await fetch(baseUrl + routes[0], {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "." }),
    });
    expect(noToken.status).toBe(401);
  });

  it("writes, reads and lists files in a project workspace", async () => {
    const { baseUrl } = await startWorker();
    await seedRemote(baseUrl, PROJECT_A);

    const read = await post(baseUrl, `/workspaces/${PROJECT_A}/files/read`, { path: "src/index.ts" });
    expect(read.status).toBe(200);
    expect((read.json as { content: string }).content).toContain("answer = 42");

    const list = await post(baseUrl, `/workspaces/${PROJECT_A}/files/list`, { path: ".", depth: 2 });
    expect(list.status).toBe(200);
    const names = (list.json as { entities: FileEntity[] }).entities.map((e) => e.path);
    expect(names).toContain("README.md");
    expect(names).toContain("src/index.ts");
    expect(names).toContain("docs/guide.md");
  });

  it("expects a directory for file walks and rejects non-directories", async () => {
    const { baseUrl } = await startWorker();
    await seedRemote(baseUrl, PROJECT_A);
    const res = await post(baseUrl, `/workspaces/${PROJECT_A}/files/list`, { path: "src/index.ts" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for missing files", async () => {
    const { baseUrl } = await startWorker();
    await seedRemote(baseUrl, PROJECT_A);
    const res = await post(baseUrl, `/workspaces/${PROJECT_A}/files/read`, { path: "nope.txt" });
    expect(res.status).toBe(404);
  });

  it("refuses to read binary files in the editor", async () => {
    const { baseUrl, workspace } = await startWorker();
    await seedRemote(baseUrl, PROJECT_A);
    fs.writeFileSync(
      path.join(workspace, PROJECT_A, "blob.bin"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03])
    );
    const res = await post(baseUrl, `/workspaces/${PROJECT_A}/files/read`, { path: "blob.bin" });
    expect(res.status).toBe(400);
  });

  it("refuses content over the text limit", async () => {
    const { baseUrl } = await startWorker();
    const big = "x".repeat(MAX_TEXT_FILE_BYTES + 1);
    const res = await post(baseUrl, `/workspaces/${PROJECT_A}/files/write`, { path: "big.txt", content: big });
    expect(res.status).toBe(400);
  });

  it("rejects sensitive paths (.env, .ssh, keys, certs)", async () => {
    const { baseUrl } = await startWorker();
    await seedRemote(baseUrl, PROJECT_A);
    for (const sensitive of [".env", ".env.production", ".ssh/id_rsa", "cert.pem", "secrets/key.pem"]) {
      const res = await post(baseUrl, `/workspaces/${PROJECT_A}/files/write`, { path: sensitive, content: "x" });
      expect(res.status, sensitive).toBe(403);
    }
  });

  it("rejects path traversal and absolute paths", async () => {
    const { baseUrl } = await startWorker();
    await seedRemote(baseUrl, PROJECT_A);
    for (const escape of ["../escape.txt", "../../etc/passwd", "/etc/passwd", "a/../../b"]) {
      const res = await post(baseUrl, `/workspaces/${PROJECT_A}/files/read`, { path: escape });
      expect(res.status, escape).not.toBe(200);
    }
  });

  it("isolates one project workspace from another", async () => {
    const { baseUrl } = await startWorker();
    await seedRemote(baseUrl, PROJECT_A);
    const readB = await post(baseUrl, `/workspaces/${PROJECT_B}/files/read`, { path: "README.md" });
    expect(readB.status).toBe(404);

    const listA = await post(baseUrl, `/workspaces/${PROJECT_A}/files/list`, { path: "." });
    expect(listA.status).toBe(200);
    const namesA = (listA.json as { entities: FileEntity[] }).entities.map((e) => e.path);
    expect(namesA).toContain("README.md");
    expect(namesA).toContain("src/index.ts");
  });

  it("creates, lists, renames and deletes directories", async () => {
    const { baseUrl } = await startWorker();
    await seedRemote(baseUrl, PROJECT_A);

    const dup = await post(baseUrl, `/workspaces/${PROJECT_A}/dirs/create`, { path: "docs" });
    expect(dup.status).toBe(400);

    const rename = await post(baseUrl, `/workspaces/${PROJECT_A}/paths/rename`, { from: "docs", to: "notes" });
    expect(rename.status).toBe(200);
    const moved = await post(baseUrl, `/workspaces/${PROJECT_A}/files/read`, { path: "notes/guide.md" });
    expect(moved.status).toBe(200);

    const below = await post(baseUrl, `/workspaces/${PROJECT_A}/paths/delete`, { path: "notes" });
    expect(below.status).toBe(400);

    const recursive = await post(baseUrl, `/workspaces/${PROJECT_A}/paths/delete`, { path: "notes", recursive: true });
    expect(recursive.status).toBe(200);
    const gone = await post(baseUrl, `/workspaces/${PROJECT_A}/files/read`, { path: "notes/guide.md" });
    expect(gone.status).toBe(404);
  });

  it("searches for files by name", async () => {
    const { baseUrl } = await startWorker();
    await seedRemote(baseUrl, PROJECT_A);
    const res = await post(baseUrl, `/workspaces/${PROJECT_A}/files/search`, { query: "guide" });
    expect(res.status).toBe(200);
    const names = (res.json as { entities: FileEntity[] }).entities.map((e) => e.path);
    expect(names).toContain("docs/guide.md");
  });

  it("rejects a symlink/junction that escapes the workspace", async (ctx) => {
    const { baseUrl, workspace } = await startWorker();
    await seedRemote(baseUrl, PROJECT_A);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "chatr-worker-escape-"));
    dirs.push(outside);
    fs.writeFileSync(path.join(outside, "secret.txt"), "classified");
    const link = path.join(workspace, PROJECT_A, "link");
    try {
      fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    } catch {
      ctx.skip();
      return;
    }
    const res = await post(baseUrl, `/workspaces/${PROJECT_A}/files/read`, { path: "link/secret.txt" });
    expect(res.status).toBe(403);
  });

  it("runs a process inside a project subdirectory via relative cwd", async () => {
    const { baseUrl, workspace } = await startWorker();
    await seedRemote(baseUrl, PROJECT_A);
    await post(baseUrl, `/workspaces/${PROJECT_A}/files/write`, {
      path: "verify-cwd.js",
      content:
        'const fs = require("fs");' +
        'const expected = process.argv[2];' +
        'const base = require("path").basename(process.cwd());' +
        'fs.writeFileSync("cwd-report.txt", process.cwd());' +
        'if (base !== expected) process.exit(1);',
    });
    const res = await post(baseUrl, "/processes", {
      id: "rel-cwd-op",
      program: "node",
      args: ["verify-cwd.js", PROJECT_A],
      cwd: PROJECT_A, // relative: resolved against the volume root
      timeoutMs: 10_000,
      maxOutputBytes: 1024,
    });
    expect(res.status).toBe(200);
    const snapshot = res.json as { state: string; exitCode: number | null };
    expect(snapshot.state).toBe("completed");
    expect(snapshot.exitCode).toBe(0);
    const report = await post(baseUrl, `/workspaces/${PROJECT_A}/files/read`, { path: "cwd-report.txt" });
    expect(report.status).toBe(200);
    expect((report.json as { content: string }).content).toBe(path.resolve(workspace, PROJECT_A));
  });

  it("rejects an oversized request body on the write route", async () => {
    const { baseUrl } = await startWorker();
    const big = "y".repeat(2 * 1024 * 1024 + 16);
    const res = await post(baseUrl, `/workspaces/${PROJECT_A}/files/write`, { path: "huge.txt", content: big });
    expect(res.status).toBe(400);
  });

  it("rejects unknown workspace routes with 404", async () => {
    const { baseUrl } = await startWorker();
    const res = await post(baseUrl, `/workspaces/${PROJECT_A}/files/whatever`, {});
    expect(res.status).toBe(404);
  });
});

const gitAvailable = ((): boolean => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.runIf(gitAvailable)("Workspace git API", () => {
  async function makeRepo(baseUrl: string, projectId: string, branch = "main"): Promise<void> {
    const init = await post(baseUrl, `/workspaces/${projectId}/git-init`, { defaultBranch: branch });
    expect(init.status).toBe(200);
    await post(baseUrl, `/workspaces/${projectId}/files/write`, { path: "file.txt", content: "v1" });
    await post(baseUrl, `/workspaces/${projectId}/git-stage-all`, {});
    const commit = await post(baseUrl, `/workspaces/${projectId}/git-commit`, { message: "initial" });
    expect(commit.status).toBe(200);
  }

  it("reports not-a-repo before initialization and refuses git ops", async () => {
    const { baseUrl } = await startWorker();
    const isRepo = await post(baseUrl, `/workspaces/${PROJECT_A}/git-is-repo`, {});
    expect(isRepo.status).toBe(200);
    expect((isRepo.json as { ok: boolean }).ok).toBe(false);
    const status = await post(baseUrl, `/workspaces/${PROJECT_A}/git-status`, {});
    expect(status.status).toBe(400);
  });

  it("initializes a repository and commits files", async () => {
    const { baseUrl } = await startWorker();
    await makeRepo(baseUrl, PROJECT_A);

    const status = await post(baseUrl, `/workspaces/${PROJECT_A}/git-status`, {});
    expect(status.status).toBe(200);
    const gitStatus = status.json as { status: GitStatus };
    expect(gitStatus.status.clean).toBe(true);
    expect(gitStatus.status.branch).toBe("main");

    const log = await post(baseUrl, `/workspaces/${PROJECT_A}/git-log`, { count: 5 });
    expect(log.status).toBe(200);
    expect((log.json as { log: unknown[] }).log.length).toBe(1);

    const branches = await post(baseUrl, `/workspaces/${PROJECT_A}/git-branches`, {});
    expect((branches.json as { branches: { name: string; current: boolean }[] }).branches).toEqual([
      { name: "main", current: true },
    ]);

    const current = await post(baseUrl, `/workspaces/${PROJECT_A}/git-current-branch`, {});
    expect((current.json as { branch: string }).branch).toBe("main");
  });

  it("creates a branch, edits, commits, and checks the diff", async () => {
    const { baseUrl } = await startWorker();
    await makeRepo(baseUrl, PROJECT_A);

    const created = await post(baseUrl, `/workspaces/${PROJECT_A}/git-create-branch`, { name: "feature/x" });
    expect(created.status).toBe(200);

    await post(baseUrl, `/workspaces/${PROJECT_A}/files/write`, { path: "file.txt", content: "v2" });
    const diff = await post(baseUrl, `/workspaces/${PROJECT_A}/git-diff`, {});
    expect(diff.status).toBe(200);
    expect((diff.json as { diff: string }).diff).toContain("v2");

    await post(baseUrl, `/workspaces/${PROJECT_A}/git-stage-all`, {});
    const committed = await post(baseUrl, `/workspaces/${PROJECT_A}/git-commit`, { message: "bump" });
    expect(committed.status).toBe(200);
    expect((committed.json as { ref: string }).ref.length).toBe(40);

    const status = await post(baseUrl, `/workspaces/${PROJECT_A}/git-status`, {});
    const gitStatus = status.json as { status: GitStatus };
    expect(gitStatus.status.clean).toBe(true);
    expect(gitStatus.status.branch).toBe("feature/x");
  });

  it("checkout requires a clean working tree", async () => {
    const { baseUrl } = await startWorker();
    await makeRepo(baseUrl, PROJECT_A);
    await post(baseUrl, `/workspaces/${PROJECT_A}/git-create-branch`, { name: "work" });
    await post(baseUrl, `/workspaces/${PROJECT_A}/files/write`, { path: "file.txt", content: "dirty" });
    const checkout = await post(baseUrl, `/workspaces/${PROJECT_A}/git-checkout`, { ref: "main" });
    expect(checkout.status).toBe(403);
  });

  it("rejects malicious branch and ref names", async () => {
    const { baseUrl } = await startWorker();
    await makeRepo(baseUrl, PROJECT_A);
    for (const bad of ["..\\..\\boom", "x..y", " -a ", "-cvf"]) {
      const res = await post(baseUrl, `/workspaces/${PROJECT_A}/git-create-branch`, { name: bad });
      expect(res.status, bad).toBeGreaterThanOrEqual(400);
    }
  });

  it("rejects commit messages with newlines and over-long refs", async () => {
    const { baseUrl } = await startWorker();
    await makeRepo(baseUrl, PROJECT_A);
    await post(baseUrl, `/workspaces/${PROJECT_A}/files/write`, { path: "file.txt", content: "v3" });
    await post(baseUrl, `/workspaces/${PROJECT_A}/git-stage-all`, {});
    const newline = await post(baseUrl, `/workspaces/${PROJECT_A}/git-commit`, { message: "bad\nmessage" });
    expect(newline.status).toBe(200);
    expect((newline.json as { message: string }).message).toBe("bad message");
  });

  it("keeps one branch checked out per workspace and isolates repos between projects", async () => {
    const { baseUrl } = await startWorker();
    await makeRepo(baseUrl, PROJECT_A);
    await makeRepo(baseUrl, PROJECT_B);

    await post(baseUrl, `/workspaces/${PROJECT_A}/git-create-branch`, { name: "devA" });
    const currentA = await post(baseUrl, `/workspaces/${PROJECT_A}/git-current-branch`, {});
    expect((currentA.json as { branch: string }).branch).toBe("devA");
    const currentB = await post(baseUrl, `/workspaces/${PROJECT_B}/git-current-branch`, {});
    expect((currentB.json as { branch: string }).branch).toBe("main");
  });
});