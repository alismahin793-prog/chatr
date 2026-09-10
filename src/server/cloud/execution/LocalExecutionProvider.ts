import { spawn, type ChildProcess } from "node:child_process";
import { AppError, NotFoundError } from "../../errors";
import type {
  CloudExecutionProvider,
  ExecutionProviderStatus,
  OutputChunk,
  PollResult,
  ProcessSnapshot,
  RunOptions,
} from "../types";

/**
 * Real, local execution provider. Runs a command as a child process with an
 * explicit argv (no shell), a ring-buffer output cap, a hard timeout, and
 * cancellation. Used in local development and vitest. On Vercel serverless it
 * honestly reports as not configured, because a stateless Function cannot host
 * persistent processes.
 */

interface Handle {
  id: string;
  program: string;
  args: string[];
  cwd: string;
  maxOutputBytes: number;
  startedAt: number;
  finishedAt: number | null;
  state: ProcessSnapshot["state"];
  exitCode: number | null;
  chunks: OutputChunk[];
  bytes: number;
  truncated: boolean;
  message?: string;
  child: ChildProcess | null;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  forceKillTimer: ReturnType<typeof setTimeout> | null;
}

const handles = new Map<string, Handle>();

/** Longest running/queued handle history before it is pruned. */
const HANDLE_TTL_MS = 60 * 60 * 1000;

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 512 * 1024;

/**
 * Env keys a spawned workspace command may inherit from this host. Everything
 * else (API keys, database URLs, Deploy tokens) is deliberately withheld so a
 * workspace script can never read or echo secrets that belong to Chatr.
 */
const SAFE_SERVER_ENV_KEYS = new Set([
  "NODE_ENV",
  "PATH",
  "PATHEXT",
  "ComSpec",
  "SystemRoot",
  "SystemDrive",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramData",
  "TEMP",
  "TMP",
  "TMPDIR",
  "WINDIR",
  "LANG",
  "LC_ALL",
  "TERM",
  "COLORTERM",
  "CI",
]);

/** Builds the child process env: safe host vars + explicit overrides only. */
export function buildSpawnEnv(explicit?: Record<string, string>): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const key of SAFE_SERVER_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  if (explicit) {
    for (const [key, value] of Object.entries(explicit)) {
      if (value !== undefined) env[key] = value;
    }
  }
  return env as NodeJS.ProcessEnv;
}

function toSnapshot(h: Handle): ProcessSnapshot {
  return {
    id: h.id,
    program: h.program,
    args: h.args,
    state: h.state,
    exitCode: h.exitCode,
    startedAt: h.startedAt,
    finishedAt: h.finishedAt,
    durationMs: h.finishedAt !== null ? h.finishedAt - h.startedAt : Date.now() - h.startedAt,
    bytes: h.bytes,
    truncated: h.truncated,
    message: h.message,
  };
}

function pushChunk(h: Handle, kind: OutputChunk["kind"], text: string): void {
  if (h.truncated || text.length === 0) return;
  const bytes = Buffer.byteLength(text, "utf8");
  const remaining = h.maxOutputBytes - h.bytes;
  if (remaining <= 0) {
    h.truncated = true;
    return;
  }
  if (bytes > remaining) {
    const kept = Buffer.from(text).subarray(0, remaining).toString("utf8");
    h.bytes += Buffer.byteLength(kept, "utf8");
    h.chunks.push({ seq: h.chunks.length, kind, text: kept });
    h.truncated = true;
    return;
  }
  h.bytes += bytes;
  h.chunks.push({ seq: h.chunks.length, kind, text });
}

function clearHandleTimers(h: Handle): void {
  if (h.timeoutTimer !== null) {
    clearTimeout(h.timeoutTimer);
    h.timeoutTimer = null;
  }
  if (h.forceKillTimer !== null) {
    clearTimeout(h.forceKillTimer);
    h.forceKillTimer = null;
  }
}

function finish(h: Handle, state: ProcessSnapshot["state"], exitCode: number | null): void {
  clearHandleTimers(h);
  h.state = state;
  h.exitCode = exitCode;
  h.finishedAt = Date.now();
  h.child = null;
}

function terminateChild(h: Handle): void {
  if (h.child && h.child.exitCode === null) {
    h.child.kill("SIGTERM");
    h.forceKillTimer = setTimeout(() => {
      if (h.child && h.child.exitCode === null) h.child.kill("SIGKILL");
    }, 5000);
  }
}

function pruneOldHandles(): void {
  const cutoff = Date.now() - HANDLE_TTL_MS;
  for (const [id, h] of handles) {
    if (h.finishedAt !== null && h.finishedAt < cutoff) handles.delete(id);
  }
}

export const isOnVercedServerless = (): boolean =>
  process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production";

export class LocalExecutionProvider implements CloudExecutionProvider {
  readonly id = "local";

  status(): ExecutionProviderStatus {
    if (isOnVercedServerless()) {
      return {
        configured: false,
        id: this.id,
        label: "Local execution",
        description: "Runs commands as local child processes.",
        reason:
          "The Vercel serverless runtime cannot host persistent processes. Configure CLOUD_EXECUTION_WORKER_URL to offload execution.",
      };
    }
    return {
      configured: true,
      id: this.id,
      label: "Local execution",
      description: "Runs commands as local child processes with output limits, timeout, and cancellation.",
    };
  }

  async run(options: RunOptions): Promise<ProcessSnapshot> {
    if (!this.status().configured) {
      throw new AppError(
        "unavailable",
        "The execution provider is not configured on this runtime. Configure CLOUD_EXECUTION_WORKER_URL.",
        503
      );
    }
    pruneOldHandles();
    const timeoutMs = options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    const maxOutputBytes = options.maxOutputBytes > 0 ? options.maxOutputBytes : DEFAULT_MAX_OUTPUT_BYTES;

    const h: Handle = {
      id: options.id,
      program: options.program,
      args: options.args,
      cwd: options.cwd,
      maxOutputBytes,
      startedAt: Date.now(),
      finishedAt: null,
      state: "running",
      exitCode: null,
      chunks: [],
      bytes: 0,
      truncated: false,
      child: null,
      timeoutTimer: null,
      forceKillTimer: null,
    };

    const child = spawn(options.program, options.args, {
      cwd: options.cwd,
      env: buildSpawnEnv(options.env),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    h.child = child;

    child.stdout?.on("data", (data: Buffer) => pushChunk(h, "stdout", data.toString("utf8")));
    child.stderr?.on("data", (data: Buffer) => pushChunk(h, "stderr", data.toString("utf8")));

    child.on("error", (err) => {
      h.message = err.message;
      finish(h, "error", null);
    });
    child.on("close", (code, signal) => {
      clearHandleTimers(h);
      h.child = null;
      if (h.state === "timed_out") {
        finish(h, "timed_out", null);
        return;
      }
      if (h.state === "cancelled") {
        finish(h, "cancelled", null);
        return;
      }
      const effectiveCode = typeof code === "number" ? code : signal ? 1 : null;
      finish(h, "completed", effectiveCode);
    });

    h.timeoutTimer = setTimeout(() => {
      if (h.state !== "running") return;
      h.state = "timed_out";
      terminateChild(h);
    }, timeoutMs);

    handles.set(h.id, h);
    return toSnapshot(h);
  }

  poll(id: string, since: number): PollResult {
    const h = getHandle(id);
    return {
      snapshot: toSnapshot(h),
      newOutput: h.chunks.filter((chunk) => chunk.seq > since),
    };
  }

  async cancel(id: string): Promise<ProcessSnapshot> {
    const h = getHandle(id);
    if (h.state === "running") {
      h.state = "cancelled";
      terminateChild(h);
      clearHandleTimers(h);
    }
    return toSnapshot(h);
  }

  list(): ProcessSnapshot[] {
    pruneOldHandles();
    return [...handles.values()].map(toSnapshot);
  }
}

function getHandle(id: string): Handle {
  const h = handles.get(id);
  if (!h) throw new NotFoundError("No such operation.");
  return h;
}