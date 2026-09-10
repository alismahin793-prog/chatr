import os from "node:os";
import path from "node:path";

/**
 * Environment configuration for the Cloud Execution worker.
 *
 * All worker settings come from explicit environment variable NAMES and are
 * validated at startup (fail-fast). The token is never logged or echoed. The
 * workspace root defaults to the same directory the app uses so a local
 * worker + app pair works without any extra configuration.
 */

export interface WorkerConfig {
  host: string;
  port: number;
  token: string;
  workspaceRoot: string;
  maxConcurrent: number;
  maxTimeoutMs: number;
  maxOutputBytes: number;
  requestBodyLimit: number;
}

const DEFAULT_PORT = 8787;
const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_MAX_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_REQUEST_BODY_LIMIT = 64 * 1024;

/** Same default location as the app's CLOUD_WORKSPACE_ROOT. */
function defaultWorkspaceRoot(): string {
  return path.join(os.tmpdir(), "chatr-cloud-workspaces");
}

function parseEnvInt(value: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function requireNonEmpty(value: string | undefined, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required.`);
  }
  return value;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): WorkerConfig {
  const token = requireNonEmpty(env.CLOUD_EXECUTION_WORKER_TOKEN, "CLOUD_EXECUTION_WORKER_TOKEN");

  const workspaceRoot = path.resolve(
    typeof env.CLOUD_WORKER_WORKSPACE_ROOT === "string" && env.CLOUD_WORKER_WORKSPACE_ROOT !== ""
      ? env.CLOUD_WORKER_WORKSPACE_ROOT
      : defaultWorkspaceRoot()
  );

  return {
    host: typeof env.CLOUD_EXECUTION_WORKER_HOST === "string" && env.CLOUD_EXECUTION_WORKER_HOST !== ""
      ? env.CLOUD_EXECUTION_WORKER_HOST
      : "127.0.0.1",
    port: parseEnvInt(env.CLOUD_EXECUTION_WORKER_PORT, DEFAULT_PORT, 0, 65535, "CLOUD_EXECUTION_WORKER_PORT"),
    token,
    workspaceRoot,
    maxConcurrent: parseEnvInt(
      env.CLOUD_WORKER_MAX_CONCURRENT,
      DEFAULT_MAX_CONCURRENT,
      1,
      64,
      "CLOUD_WORKER_MAX_CONCURRENT"
    ),
    maxTimeoutMs: parseEnvInt(
      env.CLOUD_WORKER_MAX_TIMEOUT_MS,
      DEFAULT_MAX_TIMEOUT_MS,
      60_000,
      24 * 60 * 60_000,
      "CLOUD_WORKER_MAX_TIMEOUT_MS"
    ),
    maxOutputBytes: parseEnvInt(
      env.CLOUD_WORKER_MAX_OUTPUT_BYTES,
      DEFAULT_MAX_OUTPUT_BYTES,
      1024,
      64 * 1024 * 1024,
      "CLOUD_WORKER_MAX_OUTPUT_BYTES"
    ),
    requestBodyLimit: parseEnvInt(
      env.CLOUD_WORKER_REQUEST_BODY_LIMIT,
      DEFAULT_REQUEST_BODY_LIMIT,
      1024,
      1024 * 1024,
      "CLOUD_WORKER_REQUEST_BODY_LIMIT"
    ),
  };
}