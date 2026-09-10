import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildChildEnv } from "../src/env";
import { ValidationError } from "../../src/server/errors";

const roots: string[] = [];
let scriptDir: string;

beforeEach(() => {
  scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatr-worker-env-"));
  roots.push(scriptDir);
  process.env.CLOUD_EXECUTION_WORKER_TOKEN = "worker-token-secret";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sk-service-role-secret-123456";
  process.env.DATABASE_URL = "postgres://secret@db.example/prod";
});

afterEach(() => {
  delete process.env.CLOUD_EXECUTION_WORKER_TOKEN;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.DATABASE_URL;
  for (const root of roots.splice(0)) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

function runNodeCapture(scriptFile: string, childEnv: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [scriptFile], { stdio: ["ignore", "pipe", "pipe"], env: childEnv });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.stderr?.on("data", (d: Buffer) => (err += d.toString("utf8")));
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`node exited ${code}: ${err}`));
    });
    child.on("error", reject);
  });
}

describe("buildChildEnv", () => {
  it("rejects worker secrets and secret-looking names", () => {
    expect(() => buildChildEnv({ CLOUD_EXECUTION_WORKER_TOKEN: "x" })).toThrow(ValidationError);
    expect(() => buildChildEnv({ CLOUD_WORKER_WORKSPACE_ROOT: "x" })).toThrow(ValidationError);
    expect(() => buildChildEnv({ DATABASE_URL: "x" })).toThrow(ValidationError);
    expect(() => buildChildEnv({ SUPABASE_SERVICE_ROLE_KEY: "x" })).toThrow(ValidationError);
    expect(() => buildChildEnv({ NPM_TOKEN: "x" })).toThrow(ValidationError);
    expect(() => buildChildEnv({ MY_SECRET: "x" })).toThrow(ValidationError);
  });

  it("rejects structural variable overrides", () => {
    expect(() => buildChildEnv({ PATH: "/usr/bin" })).toThrow(ValidationError);
    expect(() => buildChildEnv({ ComSpec: "cmd.exe" })).toThrow(ValidationError);
    expect(() => buildChildEnv({ SystemRoot: "C:\\Windows" })).toThrow(ValidationError);
  });

  it("passes allowed variables through", () => {
    const env = buildChildEnv({ MY_BUILD_VAR: "hello", CI: "true" }) as Record<string, string>;
    expect(env.MY_BUILD_VAR).toBe("hello");
    expect(env.CI).toBe("true");
  });

  it("never lets a child see host secrets", async () => {
    const script = path.join(
      scriptDir,
      "visibility.js"
    );
    fs.writeFileSync(
      script,
      'console.log(JSON.stringify({a:process.env.MY_BUILD_VAR,b:typeof process.env.CLOUD_EXECUTION_WORKER_TOKEN,c:typeof process.env.SUPABASE_SERVICE_ROLE_KEY,d:typeof process.env.DATABASE_URL}))'
    );
    const output = await runNodeCapture(script, buildChildEnv({ MY_BUILD_VAR: "hello" }));
    const seen = JSON.parse(output) as {
      a: string;
      b: string;
      c: string;
      d: string;
    };
    expect(seen.a).toBe("hello");
    expect(seen.b).toBe("undefined");
    expect(seen.c).toBe("undefined");
    expect(seen.d).toBe("undefined");
  });
});