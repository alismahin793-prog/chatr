import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WorkerHandle } from "../src/server";
import { loadConfig, type WorkerConfig } from "../src/config";
import { AppError } from "../../src/server/errors";
import { RemoteExecutionProvider } from "../../src/server/cloud/execution/providers";

const handles: WorkerHandle[] = [];
const dirs: string[] = [];

const TEST_TOKEN = "test-token-123";

interface WorkerUnderTest {
  baseUrl: string;
  handle: WorkerHandle;
  workspace: string;
}

async function startWorker(overrides: Partial<WorkerConfig> = {}): Promise<WorkerUnderTest> {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "chatr-worker-http-"));
  dirs.push(workspace);
  const config = loadConfig({
    CLOUD_EXECUTION_WORKER_TOKEN: TEST_TOKEN,
    CLOUD_EXECUTION_WORKER_HOST: "127.0.0.1",
    CLOUD_EXECUTION_WORKER_PORT: "0",
    CLOUD_WORKER_WORKSPACE_ROOT: workspace,
  });
  const handle = new WorkerHandle({
    ...config,
    port: 0,
    ...overrides,
  });
  handles.push(handle);
  await new Promise<void>((resolve) => handle.server.listen(0, "127.0.0.1", resolve));
  const addr = handle.server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${addr.port}`, handle, workspace };
}

function request(
  baseUrl: string,
  route: string,
  init: { method?: string; body?: unknown; token?: string } = {}
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`;
  return fetch(baseUrl + route, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  }).then(async (res) => ({ status: res.status, json: await res.json().catch(() => undefined) }));
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

describe("Cloud Execution worker HTTP contract", () => {
  it("serves /health without authentication", async () => {
    const { baseUrl } = await startWorker();
    const res = await request(baseUrl, "/health");
    expect(res.status).toBe(200);
    const body = res.json as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("cloud-execution-worker");
  });

  it("rejects /processes without a token", async () => {
    const { baseUrl } = await startWorker();
    const res = await request(baseUrl, "/processes", { method: "POST", body: {}, token: undefined });
    expect(res.status).toBe(401);
  });

  it("rejects /processes with a wrong token", async () => {
    const { baseUrl } = await startWorker();
    const res = await request(baseUrl, "/processes", { method: "POST", body: {}, token: "wrong" });
    expect(res.status).toBe(401);
  });

  it("runs a process to completion and returns the terminal snapshot", async () => {
    const { baseUrl, workspace } = await startWorker();
    const res = await request(baseUrl, "/processes", {
      method: "POST",
      token: TEST_TOKEN,
      body: {
        id: "op-1",
        program: "node",
        args: ["-p", "6*7"],
        cwd: workspace,
        timeoutMs: 10_000,
        maxOutputBytes: 1024,
      },
    });
    expect(res.status).toBe(200);
    const snapshot = res.json as { state: string; exitCode: number | null; bytes: number; truncated: boolean };
    expect(snapshot.state).toBe("completed");
    expect(snapshot.exitCode).toBe(0);
    expect(snapshot.bytes).toBeGreaterThan(0);
    expect(snapshot.truncated).toBe(false);
  });

  it("rejects commands that are not on the allowlist", async () => {
    const { baseUrl, workspace } = await startWorker();
    const res = await request(baseUrl, "/processes", {
      method: "POST",
      token: TEST_TOKEN,
      body: { id: "op-bad", program: "sh", args: ["-c", "id"], cwd: workspace, timeoutMs: 1000, maxOutputBytes: 1024 },
    });
    expect(res.status).toBe(403);
  });

  it("rejects a cwd that escapes the workspace", async () => {
    const { baseUrl } = await startWorker();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "chatr-worker-outside-"));
    dirs.push(outside);
    const res = await request(baseUrl, "/processes", {
      method: "POST",
      token: TEST_TOKEN,
      body: { id: "op-escape", program: "node", args: ["-p", "1"], cwd: outside, timeoutMs: 1000, maxOutputBytes: 1024 },
    });
    expect(res.status).toBe(403);
  });

  it("rejects malformed bodies with 400", async () => {
    const { baseUrl } = await startWorker();
    const invalidJson = await fetch(baseUrl + "/processes", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TEST_TOKEN}` },
      body: "not-json{",
    });
    expect(invalidJson.status).toBe(400);

    const missingFields = await request(baseUrl, "/processes", { method: "POST", token: TEST_TOKEN, body: {} });
    expect(missingFields.status).toBe(400);
  });

  it("enforces the concurrency limit with 409", async () => {
    const { baseUrl, workspace } = await startWorker({ maxConcurrent: 1 });
    fs.writeFileSync(path.join(workspace, "sleep.js"), "setTimeout(function(){}, 4000)");
    const longRun = request(baseUrl, "/processes", {
      method: "POST",
      token: TEST_TOKEN,
      body: {
        id: "op-cap-1",
        program: "node",
        args: ["sleep.js"],
        cwd: workspace,
        timeoutMs: 10_000,
        maxOutputBytes: 1024,
      },
    });
    await sleep(200);
    const second = await request(baseUrl, "/processes", {
      method: "POST",
      token: TEST_TOKEN,
      body: {
        id: "op-cap-2",
        program: "node",
        args: ["-p", "1"],
        cwd: workspace,
        timeoutMs: 10_000,
        maxOutputBytes: 1024,
      },
    });
    expect(second.status).toBe(409);
    const first = await longRun;
    expect(first.status).toBe(200);
  });

  it("cancels a running process through the cancel endpoint", async () => {
    const { baseUrl, workspace } = await startWorker();
    fs.writeFileSync(path.join(workspace, "sleep.js"), "setTimeout(function(){}, 4000)");
    const runResponse = request(baseUrl, "/processes", {
      method: "POST",
      token: TEST_TOKEN,
      body: {
        id: "op-cancel-1",
        program: "node",
        args: ["sleep.js"],
        cwd: workspace,
        timeoutMs: 10_000,
        maxOutputBytes: 1024,
      },
    });
    await sleep(150);
    const cancel = await request(baseUrl, `/processes/op-cancel-1/cancel`, { method: "POST", token: TEST_TOKEN });
    expect(cancel.status).toBe(200);
    const cancelSnapshot = cancel.json as { state: string };
    expect(cancelSnapshot.state).toBe("cancelled");
    const runResult = await runResponse;
    const runSnapshot = runResult.json as { state: string };
    expect(runSnapshot.state).toBe("cancelled");
  });

  it("returns 404 when cancelling an unknown operation", async () => {
    const { baseUrl } = await startWorker();
    const res = await request(baseUrl, "/processes/op-nope/cancel", { method: "POST", token: TEST_TOKEN });
    expect(res.status).toBe(404);
  });
});

describe("RemoteExecutionProvider integration", () => {
  it("runs through the real provider end-to-end", async () => {
    const { baseUrl, workspace } = await startWorker();
    const provider = new RemoteExecutionProvider(baseUrl, TEST_TOKEN);
    const snapshot = await provider.run({
      id: "provider-op-1",
      program: "node",
      args: ["-p", "6*7"],
      cwd: workspace,
      timeoutMs: 10_000,
      maxOutputBytes: 1024,
    });
    expect(snapshot.state).toBe("completed");
    expect(snapshot.exitCode).toBe(0);
    expect(snapshot.bytes).toBeGreaterThan(0);
  });

  it("does not support polling on the remote worker", async () => {
    const { baseUrl } = await startWorker();
    const provider = new RemoteExecutionProvider(baseUrl, TEST_TOKEN);
    expect(() => provider.poll("whatever", 0)).toThrow(AppError);
    expect(() => provider.poll("whatever", -1)).toThrow(AppError);
  });

  it("reports not configured without a token and refuses to run", async () => {
    const { baseUrl } = await startWorker();
    const provider = new RemoteExecutionProvider(baseUrl);
    expect(provider.status().configured).toBe(false);
    await expect(
      provider.run({
        id: "no-token-op",
        program: "node",
        args: ["-p", "1"],
        cwd: ".",
        timeoutMs: 1000,
        maxOutputBytes: 1024,
      })
    ).rejects.toThrow(AppError);
  });

  it("surfaces a wrong token as a provider error", async () => {
    const { baseUrl, workspace } = await startWorker();
    const provider = new RemoteExecutionProvider(baseUrl, "wrong-token");
    await expect(
      provider.run({
        id: "wrong-token-op",
        program: "node",
        args: ["-p", "1"],
        cwd: workspace,
        timeoutMs: 1000,
        maxOutputBytes: 1024,
      })
    ).rejects.toThrow(AppError);
  });
});