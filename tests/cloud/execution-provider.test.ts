import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  LocalExecutionProvider,
  buildSpawnEnv,
  isOnVercedServerless,
} from "@/server/cloud/execution/LocalExecutionProvider";
import { getExecutionProvider } from "@/server/cloud/execution/providers";
import { NotFoundError } from "@/server/errors";

/**
 * Runs the REAL local execution provider with child processes: output capture,
 * timeout, and cancellation. Never mocked — this is what the terminal actually
 * executes.
 */
describe("LocalExecutionProvider", () => {
  const provider = new LocalExecutionProvider();
  let tmp: string;

  afterEach(() => {
    if (!tmp) return;
    const dir = tmp;
    tmp = "";
    // The spawned child's cwd may still be held open for a few ms on Windows.
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        return;
      } catch {
        /* retry */
      }
      const waited = new Date().getTime();
      while (new Date().getTime() - waited < 150) {
        /* busy-wait */
      }
    }
  });

  it("runs a process to completion and captures stdout", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cloud-exec-"));
    const snapshot = await provider.run({
      id: "test-1",
      program: process.execPath,
      args: ["-e", "console.log('hello cloud')"],
      cwd: tmp,
      timeoutMs: 10_000,
      maxOutputBytes: 1024,
    });
    expect(snapshot.program).toBe(process.execPath);
    // poll until finished
    let snapshotOut = snapshot;
    for (let i = 0; i < 100 && snapshotOut.state === "running"; i++) {
      await new Promise((r) => setTimeout(r, 50));
      snapshotOut = provider.poll("test-1", 0).snapshot;
    }
    expect(snapshotOut.state).toBe("completed");
    expect(snapshotOut.exitCode).toBe(0);
    // Chunk seqs start at 0, so ask for everything since -1.
    const { newOutput } = provider.poll("test-1", -1);
    const text = newOutput.map((c) => c.text).join("");
    expect(text).toContain("hello cloud");
  });

  it("captures stderr separately and preserves non-zero exit codes", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cloud-exec-"));
    await provider.run({
      id: "test-2",
      program: process.execPath,
      args: ["-e", "console.error('boom'); process.exit(3)"],
      cwd: tmp,
      timeoutMs: 10_000,
      maxOutputBytes: 1024,
    });
    let snapshotOut = provider.poll("test-2", 0).snapshot;
    for (let i = 0; i < 100 && snapshotOut.state === "running"; i++) {
      await new Promise((r) => setTimeout(r, 50));
      snapshotOut = provider.poll("test-2", 0).snapshot;
    }
    expect(snapshotOut.state).toBe("completed");
    expect(snapshotOut.exitCode).toBe(3);
    const { newOutput } = provider.poll("test-2", -1);
    expect(newOutput.find((c) => c.kind === "stderr")?.text).toContain("boom");
  });

  it("kills a process that exceeds its timeout", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cloud-exec-"));
    await provider.run({
      id: "test-3",
      program: process.execPath,
      args: ["-e", "setTimeout(function(){}, 300000)"],
      cwd: tmp,
      timeoutMs: 400,
      maxOutputBytes: 1024,
    });
    let snapshotOut = provider.poll("test-3", 0).snapshot;
    for (let i = 0; i < 200 && snapshotOut.state === "running"; i++) {
      await new Promise((r) => setTimeout(r, 50));
      snapshotOut = provider.poll("test-3", 0).snapshot;
    }
    expect(["timed_out", "cancelled"]).toContain(snapshotOut.state);
  }, 30000);

  it("cancels a running process", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cloud-exec-"));
    await provider.run({
      id: "test-4",
      program: process.execPath,
      args: ["-e", "setTimeout(function(){}, 300000)"],
      cwd: tmp,
      timeoutMs: 30_000,
      maxOutputBytes: 1024,
    });
    const cancelled = await provider.cancel("test-4");
    expect(cancelled.state).toBe("cancelled");
  }, 30000);

  it("throws for unknown operations", () => {
    expect(() => provider.poll("missing-op", 0)).toThrow(NotFoundError);
  });

  it("reports not configured on the Vercel serverless runtime", () => {
    const original = { vercel: process.env.VERCEL, env: process.env.VERCEL_ENV };
    try {
      process.env.VERCEL = "1";
      process.env.VERCEL_ENV = "production";
      expect(isOnVercedServerless()).toBe(true);
      expect(provider.status().configured).toBe(false);
      process.env.VERCEL = "1";
      process.env.VERCEL_ENV = "preview";
      expect(isOnVercedServerless()).toBe(false);
      expect(provider.status().configured).toBe(true);
    } finally {
      if (original.vercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = original.vercel;
      if (original.env === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = original.env;
    }
  });

  it("exposes a cached provider via the factory", () => {
    const providerA = getExecutionProvider();
    const providerB = getExecutionProvider();
    expect(providerA).toBe(providerB);
  });
});

/**
 * Spawned workspace processes must never inherit Chatr's own secrets (service
 * keys, DB URLs, deploy tokens). Only a denylisted set of safe, non-secret
 * host variables is passed along.
 */
describe("buildSpawnEnv (secret hygiene)", () => {
  const original: Record<string, string | undefined> = {};
  const PRESENTED = [
    "PATH",
    "NODE_ENV",
    "HOME",
    "TEMP",
    "SUPABASE_SERVICE_ROLE_KEY",
    "DATABASE_URL",
    "VERCEL_TOKEN",
    "NPM_TOKEN",
    "AWS_SECRET_ACCESS_KEY",
    "ANTHROPIC_API_KEY",
  ];

  beforeAll(() => {
    for (const key of PRESENTED) {
      original[key] = process.env[key];
      process.env[key] = key === "NODE_ENV" ? "test" : `fake-${key.toLowerCase()}-value`;
    }
  });

  afterAll(() => {
    for (const key of PRESENTED) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it("keeps only safe, non-secret host variables", () => {
    const env = buildSpawnEnv();
    expect(env.PATH).toBe(process.env.PATH);
    expect(env.NODE_ENV).toBe("test");
    expect(env.HOME).toBe(process.env.HOME);
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.VERCEL_TOKEN).toBeUndefined();
    expect(env.NPM_TOKEN).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("applies explicit overrides and merges safe keys", () => {
    const env = buildSpawnEnv({ CI: "true", CUSTOM_FOO: "bar" });
    expect(env.CI).toBe("true");
    expect(env.PATH).toBe(process.env.PATH);
    // explicit values never smuggle in secrets captured from process.env
    expect(env.CUSTOM_FOO).toBe("bar");
  });
});