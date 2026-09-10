import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("requires a token", () => {
    expect(() => loadConfig({})).toThrow(/CLOUD_EXECUTION_WORKER_TOKEN/);
  });

  it("applies defaults when only the token is set", () => {
    const config = loadConfig({ CLOUD_EXECUTION_WORKER_TOKEN: "sekret" });
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(8787);
    expect(config.maxConcurrent).toBe(2);
    expect(config.maxTimeoutMs).toBe(30 * 60_000);
    expect(config.maxOutputBytes).toBe(2 * 1024 * 1024);
    expect(config.requestBodyLimit).toBe(64 * 1024);
    expect(config.workspaceRoot).toContain("chatr-cloud-workspaces");
  });

  it("reads every override from the environment", () => {
    const config = loadConfig({
      CLOUD_EXECUTION_WORKER_TOKEN: "sekret",
      CLOUD_EXECUTION_WORKER_HOST: "0.0.0.0",
      CLOUD_EXECUTION_WORKER_PORT: "9000",
      CLOUD_WORKER_WORKSPACE_ROOT: "C:\\work\\ws",
      CLOUD_WORKER_MAX_CONCURRENT: "4",
      CLOUD_WORKER_MAX_TIMEOUT_MS: "600000",
      CLOUD_WORKER_MAX_OUTPUT_BYTES: "1048576",
      CLOUD_WORKER_REQUEST_BODY_LIMIT: "16384",
    });
    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(9000);
    expect(config.workspaceRoot).toBe("C:\\work\\ws");
    expect(config.maxConcurrent).toBe(4);
    expect(config.maxTimeoutMs).toBe(600000);
    expect(config.maxOutputBytes).toBe(1048576);
    expect(config.requestBodyLimit).toBe(16384);
  });

  it("rejects invalid integers", () => {
    expect(() => loadConfig({ CLOUD_EXECUTION_WORKER_TOKEN: "t", CLOUD_EXECUTION_WORKER_PORT: "abc" })).toThrow();
    expect(() => loadConfig({ CLOUD_EXECUTION_WORKER_TOKEN: "t", CLOUD_EXECUTION_WORKER_PORT: "70000" })).toThrow();
    expect(() => loadConfig({ CLOUD_EXECUTION_WORKER_TOKEN: "t", CLOUD_WORKER_MAX_CONCURRENT: "0" })).toThrow();
  });
});