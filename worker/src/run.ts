import { spawn, type ChildProcess } from "node:child_process";
import type { ProcessSnapshot, ProcessState } from "../../src/server/cloud/types";
import { redactSecretContent } from "../../src/server/cloud/paths";

/**
 * Blocking run engine for the Cloud Execution worker.
 *
 * POST /processes is contractually required to return the terminal snapshot:
 * the RemoteExecutionProvider has no poll or stream endpoint, so the app
 * finalizes an operation from the run() response alone. This engine spawns a
 * child (shell:false, explicit argv), enforces a hard timeout (SIGTERM then
 * SIGKILL after a grace period), supports cancellation via a concurrent
 * request, and resolves the returned promise exactly once at a terminal state.
 *
 * Output is bounded to maxOutputBytes, sanitized (secret redaction + NUL
 * stripping) before being counted, and is never retained after the terminal
 * snapshot is produced (the provider contract has no output streaming).
 */

const FORCE_KILL_GRACE_MS = 5_000;
const BACKSTOP_MS = 30_000;

export interface RunRequest {
  id: string;
  program: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface RunRecord {
  id: string;
  program: string;
  args: string[];
  startedAt: number;
  finishedAt: number | null;
  state: ProcessState;
  exitCode: number | null;
  bytes: number;
  truncated: boolean;
  maxOutputBytes: number;
  message?: string;
  child: ChildProcess | null;
  cancelRequested: boolean;
}

export interface StartedRun {
  record: RunRecord;
  done: Promise<ProcessSnapshot>;
}

export function startRun(opts: RunRequest): StartedRun {
  const record: RunRecord = {
    id: opts.id,
    program: opts.program,
    args: opts.args,
    startedAt: Date.now(),
    finishedAt: null,
    state: "running",
    exitCode: null,
    bytes: 0,
    truncated: false,
    maxOutputBytes: opts.maxOutputBytes,
    child: null,
    cancelRequested: false,
  };

  let timeoutTimer: NodeJS.Timeout | null = null;
  let forceKillTimer: NodeJS.Timeout | null = null;
  let backstopTimer: NodeJS.Timeout | null = null;
  let resolve: ((snapshot: ProcessSnapshot) => void) | null = null;

  const done = new Promise<ProcessSnapshot>((res) => {
    resolve = res;
  });

  function clearTimers(): void {
    if (timeoutTimer !== null) {
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
    if (forceKillTimer !== null) {
      clearTimeout(forceKillTimer);
      forceKillTimer = null;
    }
    if (backstopTimer !== null) {
      clearTimeout(backstopTimer);
      backstopTimer = null;
    }
  }

  function snapshot(): ProcessSnapshot {
    return {
      id: record.id,
      program: record.program,
      args: record.args,
      state: record.state,
      exitCode: record.exitCode,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      durationMs: record.finishedAt !== null ? record.finishedAt - record.startedAt : Date.now() - record.startedAt,
      bytes: record.bytes,
      truncated: record.truncated,
      ...(record.message !== undefined ? { message: record.message } : {}),
    };
  }

  function finalize(): void {
    if (record.finishedAt === null) record.finishedAt = Date.now();
    record.child = null;
    clearTimers();
    if (resolve !== null) {
      resolve(snapshot());
      resolve = null;
    }
  }

  function terminateChild(): void {
    if (record.child && record.child.exitCode === null) {
      record.child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (record.child && record.child.exitCode === null) record.child.kill("SIGKILL");
      }, FORCE_KILL_GRACE_MS);
    }
  }

  function pushOutput(kind: "stdout" | "stderr", text: string): void {
    if (record.truncated) return;
    const fixed = redactSecretContent(text).replace(/\u0000/g, "");
    if (fixed.length === 0) return;
    const bytes = Buffer.byteLength(fixed, "utf8");
    const remaining = record.maxOutputBytes - record.bytes;
    if (remaining <= 0) {
      record.truncated = true;
      return;
    }
    if (bytes > remaining) {
      record.bytes += remaining;
      record.truncated = true;
      return;
    }
    record.bytes += bytes;
  }

  const child = spawn(opts.program, opts.args, {
    cwd: opts.cwd,
    env: opts.env,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  record.child = child;

  child.stdout?.on("data", (data: Buffer) => pushOutput("stdout", data.toString("utf8")));
  child.stderr?.on("data", (data: Buffer) => pushOutput("stderr", data.toString("utf8")));

  child.on("error", (err) => {
    if (record.state !== "running") return;
    record.state = "error";
    record.exitCode = null;
    record.message = err.message;
    finalize();
  });

  child.on("close", (code, signal) => {
    record.child = null;
    if (record.state === "running") {
      const effectiveCode = typeof code === "number" ? code : signal ? 1 : null;
      record.state = "completed";
      record.exitCode = effectiveCode;
    } else if (record.state === "error") {
      record.exitCode = null;
    } else {
      // cancelled / timed_out
      record.exitCode = null;
    }
    finalize();
  });

  timeoutTimer = setTimeout(() => {
    if (record.state !== "running") return;
    record.state = "timed_out";
    terminateChild();
  }, opts.timeoutMs);

  // Backstop: never let the HTTP request hang if the child never emits close.
  backstopTimer = setTimeout(() => {
    if (record.state === "running") {
      record.state = "error";
      record.exitCode = null;
      record.message = "The worker did not observe process exit in time.";
      terminateChild();
    }
    finalize();
  }, opts.timeoutMs + FORCE_KILL_GRACE_MS + BACKSTOP_MS);

  return { record, done };
}

/** Requests cancellation for a running process and returns its snapshot. */
export function cancelRun(record: RunRecord): ProcessSnapshot {
  if (record.state === "running") {
    record.cancelRequested = true;
    record.state = "cancelled";
    const child = record.child;
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, FORCE_KILL_GRACE_MS).unref();
    }
  }
  return snapshotOf(record);
}

function snapshotOf(record: RunRecord): ProcessSnapshot {
  return {
    id: record.id,
    program: record.program,
    args: record.args,
    state: record.state,
    exitCode: record.exitCode,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    durationMs: record.finishedAt !== null ? record.finishedAt - record.startedAt : Date.now() - record.startedAt,
    bytes: record.bytes,
    truncated: record.truncated,
    ...(record.message !== undefined ? { message: record.message } : {}),
  };
}