import type {
  CloudExecutionProvider,
  ExecutionProviderStatus,
  PollResult,
  ProcessSnapshot,
  RunOptions,
} from "../types";
import { AppError } from "../../errors";
import { LocalExecutionProvider } from "./LocalExecutionProvider";
import { workerPost } from "../workerClient";

/**
 * Remote execution provider. When CLOUD_EXECUTION_WORKER_URL is configured the
 * Cloud terminal talks to a real worker (Docker/VM/K8s job) over HTTP. This is
 * the production path for the Vercel runtime, where local processes cannot
 * persist. No simulation happens anywhere: without the URL, the provider is
 * "not configured".
 */
export class RemoteExecutionProvider implements CloudExecutionProvider {
  readonly id = "remote";
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string
  ) {}

  status(): ExecutionProviderStatus {
    if (!this.token) {
      return {
        configured: false,
        id: this.id,
        label: "Remote worker",
        description: "Executes commands on the configured Cloud Development worker.",
        reason: "CLOUD_EXECUTION_WORKER_TOKEN is not configured. Set it alongside CLOUD_EXECUTION_WORKER_URL.",
      };
    }
    return {
      configured: true,
      id: this.id,
      label: "Remote worker",
      description: "Executes commands on the configured Cloud Development worker.",
    };
  }

  run(options: RunOptions): Promise<ProcessSnapshot> {
    return workerPost<ProcessSnapshot>(
      "/processes",
      options,
      { label: `run ${options.program}` },
      { baseUrl: this.baseUrl, token: this.token }
    );
  }

  poll(id: string, since: number): PollResult | never {
    throw new AppError(
      "unavailable",
      `Polling process ${id} since ${since} is not supported on the remote worker yet; use the stream endpoint.`,
      501
    );
  }

  cancel(id: string): Promise<ProcessSnapshot> {
    return workerPost<ProcessSnapshot>(
      `/processes/${id}/cancel`,
      {},
      { label: `cancel ${id}` },
      { baseUrl: this.baseUrl, token: this.token }
    );
  }

  list(): ProcessSnapshot[] {
    return [];
  }
}

/** Honest no-op provider used when execution is genuinely unavailable. */
export class UnavailableExecutionProvider implements CloudExecutionProvider {
  readonly id = "unavailable";
  status(): ExecutionProviderStatus {
    return {
      configured: false,
      id: this.id,
      label: "Execution provider",
      description: "Executes approved commands for the Cloud terminal and pipeline.",
      reason:
        "This runtime cannot run commands. Configure CLOUD_EXECUTION_WORKER_URL to enable the Cloud terminal.",
    };
  }
  run(): Promise<ProcessSnapshot> {
    throw new AppError(
      "unavailable",
      "The execution provider is not configured on this runtime.",
      503
    );
  }
  poll(): PollResult {
    throw new AppError("unavailable", "The execution provider is not configured.", 503);
  }
  cancel(): Promise<ProcessSnapshot> {
    throw new AppError("unavailable", "The execution provider is not configured.", 503);
  }
  list(): ProcessSnapshot[] {
    return [];
  }
}

let cachedProvider: CloudExecutionProvider | null = null;

/** Returns the active execution provider (remotable, cached per process). */
export function getExecutionProvider(): CloudExecutionProvider {
  if (cachedProvider) return cachedProvider;
  if (process.env.CLOUD_EXECUTION_WORKER_URL) {
    cachedProvider = new RemoteExecutionProvider(
      process.env.CLOUD_EXECUTION_WORKER_URL,
      process.env.CLOUD_EXECUTION_WORKER_TOKEN
    );
    return cachedProvider;
  }
  const local = new LocalExecutionProvider();
  cachedProvider = local.status().configured ? local : new UnavailableExecutionProvider();
  return cachedProvider;
}

export function executionProviderStatus(): ExecutionProviderStatus {
  return getExecutionProvider().status();
}