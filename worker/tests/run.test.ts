import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { startRun, cancelRun, type RunRequest } from "../src/run";
import { buildSpawnEnv } from "../../src/server/cloud/execution/LocalExecutionProvider";

const dirs: string[] = [];

function makeWorkspace(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chatr-worker-run-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

function makeRequest(cwd: string, script: string, overrides: Partial<RunRequest> = {}): RunRequest {
  const base: RunRequest = {
    id: `op-${cwd.split(path.sep).pop()}`,
    program: "node",
    args: [script],
    cwd,
    env: buildSpawnEnv(),
    timeoutMs: 10_000,
    maxOutputBytes: 64 * 1024,
  };
  return { ...base, ...overrides, args: overrides.args ?? base.args };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe("startRun engine", () => {
  it("completes with exit code 0 and captures output", async () => {
    const dir = makeWorkspace({ "ok.js": "console.log(process.env.GREETING)" });
    const req = makeRequest(dir, "ok.js", { env: buildSpawnEnv({ GREETING: "hello" }) });
    const { done } = startRun(req);
    const snapshot = await done;
    expect(snapshot.state).toBe("completed");
    expect(snapshot.exitCode).toBe(0);
    expect(snapshot.bytes).toBeGreaterThan(0);
    expect(snapshot.finishedAt).not.toBeNull();
    expect(snapshot.durationMs).not.toBeNull();
    expect(snapshot.truncated).toBe(false);
  });

  it("captures stderr and reports non-zero exit codes", async () => {
    const dir = makeWorkspace({ "err.js": "console.error(process.env.MSG); process.exit(3)" });
    const req = makeRequest(dir, "err.js", { env: buildSpawnEnv({ MSG: "boom" }) });
    const snapshot = await startRun(req).done;
    expect(snapshot.state).toBe("completed");
    expect(snapshot.exitCode).toBe(3);
    expect(snapshot.bytes).toBeGreaterThan(0);
  });

  it("times out a process that exceeds its timeout", async () => {
    const dir = makeWorkspace({ "long.js": "setTimeout(()=>{}, 60000)" });
    const req = makeRequest(dir, "long.js", { timeoutMs: 200, maxOutputBytes: 1024 });
    const snapshot = await startRun(req).done;
    expect(snapshot.state).toBe("timed_out");
    expect(snapshot.exitCode).toBeNull();
    expect(snapshot.finishedAt).not.toBeNull();
  });

  it("cancels a running process and resolves the run as cancelled", async () => {
    const dir = makeWorkspace({ "long.js": "setTimeout(()=>{}, 60000)" });
    const req = makeRequest(dir, "long.js", { timeoutMs: 60_000, maxOutputBytes: 1024 });
    const { record, done } = startRun(req);
    await new Promise((r) => setTimeout(r, 120));
    const cancelSnapshot = cancelRun(record);
    expect(cancelSnapshot.state).toBe("cancelled");
    const finalSnapshot = await done;
    expect(finalSnapshot.state).toBe("cancelled");
    expect(finalSnapshot.exitCode).toBeNull();
  });

  it("caps output and flags truncation", async () => {
    const dir = makeWorkspace({ "big.js": "for (let i=0;i<1000;i++){ console.log('0123456789'.repeat(1000)) }" });
    const req = makeRequest(dir, "big.js", { maxOutputBytes: 1000 });
    const snapshot = await startRun(req).done;
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.bytes).toBeLessThanOrEqual(1000);
  });

  it("redacts secret-like output before counting bytes", async () => {
    const dir = makeWorkspace({ "leak.js": "console.log(process.env.LEAK)" });
    const req = makeRequest(dir, "leak.js", {
      env: buildSpawnEnv({ LEAK: "sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
    });
    const snapshot = await startRun(req).done;
    expect(snapshot.state).toBe("completed");
    // "sk-..." (28+ chars) would make bytes ~29; redacted output is ~10 bytes.
    expect(snapshot.bytes).toBeGreaterThan(0);
    expect(snapshot.bytes).toBeLessThan(20);
  });
});