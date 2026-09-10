import http from "node:http";
import {
  AppError,
  ConflictError,
  isAppError,
  NotFoundError,
  ValidationError,
} from "../../src/server/errors";
import type { ProcessSnapshot } from "../../src/server/cloud/types";
import { assertSafeCommand } from "../../src/server/cloud/execution/CommandSecurity";
import type { WorkerConfig } from "./config";
import { isAuthorized } from "./auth";
import { buildChildEnv } from "./env";
import { assertCwdInsideWorkspace } from "./workspace";
import { startRun, cancelRun, type RunRecord } from "./run";
import { Registry } from "./registry";
import { log, logWarn } from "./log";
import * as workspaceApi from "./workspaceApi";
import { WorkspaceGitApiImpl } from "./gitApi";

/**
 * HTTP surface of the Cloud Execution worker.
 *
 * The API matches the shared provider contracts exactly:
 *   POST /processes            -> ProcessSnapshot (blocks until terminal)
 *   POST /processes/:id/cancel -> ProcessSnapshot
 *   GET  /health               -> { ok, service } (unauthenticated, minimal)
 *   POST /workspaces/:id/...   -> authenticated workspace/file + git ops
 *
 * No poll/status/list/stream endpoints exist: the providers never call them
 * and adding them would widen the attack surface for no contract benefit.
 * Every endpoint except /health requires the worker Bearer token.
 */

export interface RunBody {
  id: string;
  program: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs: number;
  maxOutputBytes: number;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Write bodies carry up to a 1MB text file, so they need a larger cap. */
const WRITE_BODY_LIMIT = 2 * 1024 * 1024;

interface WorkspaceBody {
  path?: unknown;
  depth?: unknown;
  content?: unknown;
  query?: unknown;
  from?: unknown;
  to?: unknown;
  recursive?: unknown;
  count?: unknown;
  message?: unknown;
  name?: unknown;
  ref?: unknown;
  defaultBranch?: unknown;
}

export class WorkerHandle {
  server: http.Server;
  readonly registry: Registry;
  private readonly config: WorkerConfig;
  private readonly git: WorkspaceGitApiImpl;

  constructor(config: WorkerConfig) {
    this.config = config;
    this.registry = new Registry(config.maxConcurrent);
    this.git = new WorkspaceGitApiImpl();
    this.server = http.createServer((req, res) => {
      void this.handle(req, res).catch((err) => sendHttpError(res, err));
    });
    this.server.on("clientError", (_err, socket) => {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    });
  }

  shutdown(): void {
    this.registry.cancelAll();
    this.server.close();
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "GET" && pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        service: "cloud-execution-worker",
        pid: process.pid,
        uptimeMs: process.uptime() * 1000,
      });
      return;
    }

    const authorized = isAuthorized(req.headers.authorization, this.config.token);
    if (!authorized) {
      logWarn("auth_failed", { method: req.method ?? "", path: pathname });
      throw new AppError("unauthorized", "Authentication required.", 401);
    }

    if (req.method === "POST" && pathname === "/processes") {
      await this.handleRun(req, res);
      return;
    }

    const cancelMatch = /^\/processes\/([^/]+)\/cancel$/.exec(pathname);
    if (req.method === "POST" && cancelMatch) {
      this.handleCancel(cancelMatch[1], res);
      return;
    }

    const workspaceMatch = /^\/workspaces\/([^/]+)\/([a-z-]+)$/.exec(pathname);
    if (req.method === "POST" && workspaceMatch) {
      await this.handleWorkspace(workspaceMatch[1], workspaceMatch[2], req, res);
      return;
    }
    const workspaceDeepMatch = /^\/workspaces\/([^/]+)\/(files|dirs|paths)\/([a-z-]+)$/.exec(pathname);
    if (req.method === "POST" && workspaceDeepMatch) {
      await this.handleWorkspaceDeep(workspaceDeepMatch[1], workspaceDeepMatch[2], workspaceDeepMatch[3], req, res);
      return;
    }

    throw new NotFoundError("Not found.");
  }

  private async handleWorkspace(
    projectId: string,
    action: string,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const body = await readJsonBody(req, this.config.requestBodyLimit);
    const root = this.config.workspaceRoot;
    const wsRoot = await this.git.workspaceDir(root, projectId);
    const parsed = body as WorkspaceBody;

    switch (action) {
      case "git-status": {
        const status = await this.git.status(wsRoot);
        sendJson(res, 200, { status });
        return;
      }
      case "git-current-branch": {
        const current = await this.git.currentBranch(wsRoot);
        sendJson(res, 200, current);
        return;
      }
      case "git-branches": {
        const branches = await this.git.branches(wsRoot);
        sendJson(res, 200, { branches });
        return;
      }
      case "git-log": {
        const log = await this.git.log(wsRoot, integerOf(parsed.count, 20));
        sendJson(res, 200, { log });
        return;
      }
      case "git-is-repo": {
        const ok = await this.git.isRepo(wsRoot);
        sendJson(res, 200, ok);
        return;
      }
      case "git-init": {
        const ofs = await this.git.init(wsRoot, stringOf(parsed.defaultBranch, "main"));
        sendJson(res, 200, { status: ofs });
        return;
      }
      case "git-create-branch": {
        const status = await this.git.createBranch(wsRoot, stringOf(parsed.name, ""));
        sendJson(res, 200, { status });
        return;
      }
      case "git-checkout": {
        const status = await this.git.checkout(wsRoot, stringOf(parsed.ref, ""));
        sendJson(res, 200, { status });
        return;
      }
      case "git-commit": {
        const committed = await this.git.commit(wsRoot, stringOf(parsed.message, ""));
        sendJson(res, 200, committed);
        return;
      }
      case "git-stage-all": {
        const staged = await this.git.stageAll(wsRoot);
        sendJson(res, 200, staged);
        return;
      }
      case "git-push": {
        const pushed = await this.git.push(wsRoot);
        sendJson(res, 200, pushed);
        return;
      }
      case "git-pull": {
        const pulled = await this.git.pull(wsRoot);
        sendJson(res, 200, pulled);
        return;
      }
      case "git-diff": {
        const { diff } = await this.git.diff(wsRoot, stringOrUndefined(parsed.path));
        sendJson(res, 200, { diff });
        return;
      }
      default:
        throw new NotFoundError("Not found.");
    }
  }

  private async handleWorkspaceDeep(
    projectId: string,
    group: string,
    action: string,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const body = await readJsonBody(req, action === "write" ? WRITE_BODY_LIMIT : this.config.requestBodyLimit);
    const root = this.config.workspaceRoot;
    await workspaceApi.ensureWorkspaceDir(root, projectId);
    const parsed = body as WorkspaceBody;

    if (group === "files") {
      switch (action) {
        case "list": {
          const entities = await workspaceApi.listDir(root, projectId, stringOf(parsed.path, "."), optionalInt(parsed.depth));
          sendJson(res, 200, { entities });
          return;
        }
        case "read": {
          const file = await workspaceApi.readFile(root, projectId, stringOf(parsed.path, ""));
          sendJson(res, 200, file);
          return;
        }
        case "write": {
          const written = await workspaceApi.writeFile(
            root,
            projectId,
            stringOf(parsed.path, ""),
            stringOf(parsed.content, "")
          );
          sendJson(res, 200, written);
          return;
        }
        case "search": {
          const entities = await workspaceApi.search(root, projectId, stringOf(parsed.query, ""));
          sendJson(res, 200, { entities });
          return;
        }
      }
    }
    if (group === "dirs" && action === "create") {
      await workspaceApi.createDir(root, projectId, stringOf(parsed.path, ""));
      sendJson(res, 200, { ok: true });
      return;
    }
    if (group === "paths") {
      if (action === "rename") {
        await workspaceApi.renamePath(root, projectId, stringOf(parsed.from, ""), stringOf(parsed.to, ""));
        sendJson(res, 200, { ok: true });
        return;
      }
      if (action === "delete") {
        await workspaceApi.deletePath(root, projectId, stringOf(parsed.path, ""), booleanOf(parsed.recursive));
        sendJson(res, 200, { ok: true });
        return;
      }
    }
    throw new NotFoundError("Not found.");
  }

  private async handleRun(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const raw = await readJsonBody(req, this.config.requestBodyLimit);
    const parsed = parseRunBody(raw, this.config);

    // Command allowlist — the worker validates commands itself, never trusting
    // that the app already did. This is the same policy as the app provider.
    const safe = assertSafeCommand(parsed.program, parsed.args);
    const cwd = assertCwdInsideWorkspace(this.config.workspaceRoot, parsed.cwd);
    const childEnv = buildChildEnv(parsed.env);

    if (this.registry.size >= this.config.maxConcurrent) {
      throw new ConflictError("The execution worker is at capacity. Try again later.");
    }
    if (this.registry.has(parsed.id)) {
      throw new ConflictError('Operation "' + parsed.id + '" is already running.');
    }

    const started = startRun({
      ...parsed,
      program: safe.program,
      args: safe.args,
      cwd,
      env: childEnv,
    });

    this.registry.put(started.record);
    log("process_started", { id: parsed.id, program: safe.program });

    let snapshot: ProcessSnapshot;
    try {
      snapshot = await started.done;
    } finally {
      this.registry.delete(parsed.id);
    }

    log("process_finished", {
      id: parsed.id,
      state: snapshot.state,
      exitCode: snapshot.exitCode ?? null,
      bytes: snapshot.bytes,
      truncated: snapshot.truncated,
      durationMs: snapshot.durationMs ?? null,
    });

    sendJson(res, 200, snapshot);
  }

  private handleCancel(id: string, res: http.ServerResponse): void {
    const record: RunRecord | undefined = this.registry.get(id);
    if (!record) {
      throw new NotFoundError("No such operation.");
    }
    const snapshot = cancelRun(record);
    this.registry.delete(id);
    log("process_cancelled", { id, state: snapshot.state });
    sendJson(res, 200, snapshot);
  }
}

function stringOf(value: unknown, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") throw new ValidationError("Invalid string value.");
  return value;
}

function stringOrUndefined(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ValidationError("Invalid string value.");
  return value;
}

function booleanOf(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new ValidationError("Invalid boolean value.");
  return value;
}

function integerOf(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value)) throw new ValidationError("Invalid integer value.");
  return value;
}

function optionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) throw new ValidationError("Invalid integer value.");
  return value;
}

function parseRunBody(raw: unknown, config: WorkerConfig): RunBody {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ValidationError("Invalid request body.");
  }
  const o = raw as Record<string, unknown>;

  const id = requireString(o.id, "id");
  if (id.length > 128 || !ID_PATTERN.test(id)) {
    throw new ValidationError("id contains invalid characters.");
  }

  const program = requireString(o.program, "program");
  if (program.length > 120) {
    throw new ValidationError("program is too long.");
  }

  const args = requireStringArray(o.args, "args");
  let commandLength = Buffer.byteLength(program, "utf8");
  for (const arg of args) {
    commandLength += Buffer.byteLength(arg, "utf8") + 1;
  }
  if (commandLength > 8192) {
    throw new ValidationError("The command is too long.");
  }

  const cwd = requireString(o.cwd, "cwd");
  if (cwd.length > 1024) {
    throw new ValidationError("cwd is too long.");
  }

  let env: Record<string, string> | undefined;
  if (o.env !== undefined) {
    if (typeof o.env !== "object" || o.env === null || Array.isArray(o.env)) {
      throw new ValidationError("env must be an object.");
    }
    const entries = Object.entries(o.env as Record<string, unknown>);
    if (entries.length > 64) {
      throw new ValidationError("Too many environment variables.");
    }
    env = {};
    for (const [key, value] of entries) {
      if (key.length > 256 || !ENV_NAME_PATTERN.test(key)) {
        throw new ValidationError(`Invalid environment variable name "${key}".`);
      }
      if (typeof value !== "string" || value.length > 4096) {
        throw new ValidationError(`Invalid value for environment variable "${key}".`);
      }
      env[key] = value;
    }
  }

  const timeoutMs = requireInteger(o.timeoutMs, "timeoutMs");
  if (timeoutMs < 1 || timeoutMs > config.maxTimeoutMs) {
    throw new ValidationError(`timeoutMs must be between 1 and ${config.maxTimeoutMs}.`);
  }

  const maxOutputBytes = requireInteger(o.maxOutputBytes, "maxOutputBytes");
  if (maxOutputBytes < 1024 || maxOutputBytes > config.maxOutputBytes) {
    throw new ValidationError(`maxOutputBytes must be between 1024 and ${config.maxOutputBytes}.`);
  }

  return { id, program, args, cwd, env, timeoutMs, maxOutputBytes };
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`${name} must be a non-empty string.`);
  }
  return value;
}

function requireStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length > 128) {
    throw new ValidationError(`${name} must be an array of at most 128 strings.`);
  }
  for (const item of value) {
    if (typeof item !== "string" || item.length > 400) {
      throw new ValidationError(`Each ${name} entry must be a string of at most 400 characters.`);
    }
  }
  return value as string[];
}

function requireInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ValidationError(`${name} must be an integer.`);
  }
  return value;
}

function readJsonBody(req: http.IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks: Buffer[] = [];

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      fn();
    };

    const onData = (chunk: Buffer): void => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        finish(() => reject(new ValidationError("Request body is too large.")));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => {
      finish(() => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
        } catch {
          reject(new ValidationError("Request body must be valid JSON."));
        }
      });
    };
    const onError = (err: Error): void => {
      finish(() => reject(err));
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendHttpError(res: http.ServerResponse, err: unknown): void {
  const mapped = toHttpError(err);
  logWarn("request_error", { status: mapped.status, code: mapped.code, message: mapped.message });
  sendJson(res, mapped.status, { error: { code: mapped.code, message: mapped.message } });
}

function toHttpError(err: unknown): { status: number; code: string; message: string } {
  if (isAppError(err)) {
    return { status: err.status, code: err.code, message: err.message };
  }
  if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
    return { status: 500, code: "internal", message: "The worker could not start the process." };
  }
  if (err instanceof SyntaxError) {
    return { status: 400, code: "validation", message: "Request body must be valid JSON." };
  }
  return { status: 500, code: "internal", message: "Internal worker error." };
}