import { AppError, type ErrorCode } from "@/server/errors";

/**
 * Shared HTTP client for the Cloud Development worker.
 *
 * Every remote provider (execution, workspace, git) funnels through this
 * client so error mapping and authentication stay identical everywhere. The
 * worker's error envelope is `{ error: { code, message } }` with a real HTTP
 * status; that is preserved as an AppError so the app surfaces the worker's
 * actual validation/forbidden/not-found reasons instead of a generic 502.
 *
 * Timeouts: long-running commands (`POST /processes`, installs, builds) MUST
 * NOT pass a timeout — they routinely run for minutes. Bounded ops (file/git)
 * use a generous 60s cap.
 */

export interface WorkerClientConfig {
  baseUrl?: string;
  token?: string;
}

export function resolveWorkerConfig(explicit?: WorkerClientConfig): WorkerClientConfig {
  return {
    baseUrl:
      explicit?.baseUrl ?? process.env.CLOUD_EXECUTION_WORKER_URL ?? "",
    token:
      explicit && explicit.token !== undefined
        ? explicit.token
        : process.env.CLOUD_EXECUTION_WORKER_TOKEN,
  };
}

/** True when a worker URL AND token are configured for this runtime. */
export function workerConfigured(): boolean {
  return Boolean(
    process.env.CLOUD_EXECUTION_WORKER_URL &&
      process.env.CLOUD_EXECUTION_WORKER_TOKEN
  );
}

export interface WorkerPostOptions {
  /** Bounded ops set this; command execution (/processes) deliberately leaves it unset. */
  timeoutMs?: number;
  /** Label used in the timeout error when the worker is unreachable/slow. */
  label?: string;
}

/** POSTs JSON to the worker and maps the response (or failure) to AppError. */
export async function workerPost<T>(
  path: string,
  body: unknown,
  options: WorkerPostOptions = {},
  config?: WorkerClientConfig
): Promise<T> {
  const { baseUrl, token } = resolveWorkerConfig(config);
  if (!baseUrl) {
    throw new AppError(
      "unavailable",
      "CLOUD_EXECUTION_WORKER_URL is not configured for the Cloud Development worker.",
      503
    );
  }
  if (!token) {
    throw new AppError(
      "unavailable",
      "CLOUD_EXECUTION_WORKER_TOKEN is not configured for the Cloud Development worker.",
      503
    );
  }

  const controller =
    typeof options.timeoutMs === "number" ? new AbortController() : undefined;
  const timer =
    controller && typeof options.timeoutMs === "number"
      ? setTimeout(() => controller.abort(), options.timeoutMs)
      : undefined;

  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller?.signal,
    });

    const payload = (await res.json().catch(() => undefined)) as
      | { error?: { code?: string; message?: string } }
      | T
      | undefined;

    if (!res.ok) {
      const err = (payload as { error?: { code?: string; message?: string } } | undefined)
        ?.error;
      const knownCodes: ErrorCode[] = ["unauthorized", "forbidden", "not_found", "validation", "conflict"];
      const code =
        err?.code && (knownCodes as string[]).includes(err.code)
          ? (err.code as ErrorCode)
          : "unavailable";
      const mappedStatus =
        err?.code === "validation" || err?.code === "forbidden"
          ? res.status === 401
            ? 401
            : res.status
          : err?.code === "not_found"
            ? 404
            : 502;
      throw new AppError(
        code,
        err?.message ?? `The Cloud Development worker reported an error (${res.status}).`,
        mappedStatus
      );
    }
    if (payload === undefined) {
      throw new AppError("unavailable", "The Cloud Development worker returned an empty response.", 502);
    }
    return payload as T;
  } catch (err) {
    if (controller?.signal.aborted) {
      throw new AppError(
        "unavailable",
        `The Cloud Development worker timed out for ${options.label ?? path}.`,
        504
      );
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}