import fs from "node:fs";
import path from "node:path";
import type {
  CreateDeploymentInput,
  CreatedDeployment,
  DeploymentProvider,
  DeploymentProviderStatus,
  DeploymentStatus,
  WorkspaceProvider,
} from "@/server/cloud/types";
import { AppError } from "@/server/errors";
import { getWorkspaceProvider } from "@/server/cloud/workspace/providers";

/**
 * Vercel deployment provider (real REST integration).
 *
 * Only becomes "configured" when BOTH VERCEL_TOKEN and VERCEL_PROJECT_ID are
 * present server-side. It walks the workspace directory and creates a real
 * deployment through the Vercel REST API; status/url are read back from the
 * provider response. Without credentials this provider stays unconfigured and
 * the UI says so — it never fabricates URLs or statuses.
 */

const UPLOAD_MAX_FILES = 400;
const UPLOAD_MAX_BYTES = 1024 * 1024;

const IGNORED_DIRS = new Set(["node_modules", ".git", ".next", ".vercel", ".svn", ".hg", ".serverless"]);
const IGNORED_FILES = new Set([".DS_Store", ".env.development", ".env.production", "npm-debug.log"]);

interface WalkResult {
  files: { file: string; data: string }[];
}

/**
 * A source of deployable files for a workspace. The local host reads the
 * filesystem directly; when the workspace lives on the worker volume, files
 * are read through the active WorkspaceProvider instead.
 */
export interface WorkspaceFileReader {
  readRootFiles(root: string): Promise<{ file: string; data: string }[]>;
}

function shouldSkipDeployEntry(name: string, relPath: string): boolean {
  if (IGNORED_FILES.has(name) || /\.env(\.[a-zA-Z0-9_-]+)?$/i.test(name)) return true;
  const parts = relPath.replace(/\\/g, "/").split("/");
  return parts.some((part) => IGNORED_DIRS.has(part));
}

function walk(dir: string, rel = "", acc: { file: string; data: string }[] = [], bytes = 0): WalkResult {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (acc.length >= UPLOAD_MAX_FILES || bytes >= UPLOAD_MAX_BYTES) break;
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), relPath, acc, bytes);
      continue;
    }
    if (shouldSkipDeployEntry(entry.name, relPath)) continue;
    let content: Buffer;
    try {
      content = fs.readFileSync(path.join(dir, entry.name));
    } catch {
      continue; // unreadable/broken symlink: skip
    }
    bytes += content.byteLength;
    if (bytes > UPLOAD_MAX_BYTES) break;
    acc.push({ file: relPath, data: content.toString("utf8") });
  }
  return { files: acc };
}

/**
 * Reads deployable files through a WorkspaceProvider (worker volume). Binary
 * assets the worker refuses to open as text are skipped, matching the local
 * walk's text payload while never leaking binary bytes.
 */
export function remoteWorkspaceFileReader(workspace: WorkspaceProvider): WorkspaceFileReader {
  return {
    async readRootFiles(root: string): Promise<{ file: string; data: string }[]> {
      const entities = await workspace.listDir(root, ".", { depth: 64 });
      const acc: { file: string; data: string }[] = [];
      let bytes = 0;
      for (const entry of entities) {
        if (acc.length >= UPLOAD_MAX_FILES || bytes >= UPLOAD_MAX_BYTES) break;
        if (entry.type !== "file") continue;
        if (shouldSkipDeployEntry(entry.path.split("/").pop() ?? entry.path, entry.path)) continue;
        try {
          const { content } = await workspace.readFile(root, entry.path);
          bytes += Buffer.byteLength(content, "utf8");
          if (bytes > UPLOAD_MAX_BYTES) break;
          acc.push({ file: entry.path, data: content });
        } catch {
          continue; // binary/gone: skip
        }
      }
      return acc;
    },
  };
}

function statusFromReadyState(readyState: string | null): DeploymentStatus {
  switch (readyState) {
    case "READY":
      return "ready";
    case "QUEUED":
    case "INITIALIZING":
    case "BUILDING":
    case "PROVISIONING":
    case "ANALYZING":
      return "building";
    case "CANCELED":
      return "cancelled";
    default:
      return "failed";
  }
}

export class VercelDeploymentProvider implements DeploymentProvider {
  readonly id = "vercel";

  constructor(
    private readonly token: string,
    private readonly projectId: string,
    private readonly orgId?: string,
    private readonly filesSource?: WorkspaceFileReader
  ) {}

  private apiUrl(pathAndQuery: string): string {
    const teamId = this.orgId ? `?teamId=${encodeURIComponent(this.orgId)}` : "";
    return `https://api.vercel.com${pathAndQuery}${teamId}`;
  }

  private async request<T>(pathAndQuery: string, init?: RequestInit): Promise<T> {
    const res = await fetch(this.apiUrl(pathAndQuery), {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    if (!res.ok) {
      throw new AppError(
        "unavailable",
        `Vercel API error (${res.status}): ${body?.message ?? "Unknown provider error."}`,
        502
      );
    }
    return body as unknown as T;
  }

  status(): DeploymentProviderStatus {
    return {
      configured: true,
      id: this.id,
      label: "Vercel (REST)",
      providerProjectId: this.projectId,
      reason: undefined,
    };
  }

  async createDeployment(input: CreateDeploymentInput): Promise<CreatedDeployment> {
    let files: { file: string; data: string }[];
    if (this.filesSource) {
      files = await this.filesSource.readRootFiles(input.workspaceRoot);
    } else {
      if (!fs.existsSync(input.workspaceRoot)) {
        throw new AppError("not_found", "Workspace does not exist; initialize the project first.", 404);
      }
      files = walk(input.workspaceRoot).files;
    }
    if (files.length === 0) {
      throw new AppError("unavailable", "Workspace has no files to deploy. Initialize a project first.", 422);
    }
    const body: Record<string, unknown> = {
      name: input.projectId.slice(0, 20),
      project: this.projectId,
      files,
    };
    if (input.kind === "production") body.target = "production";
    const deployment = await this.request<Record<string, unknown>>("/v13/deployments", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return {
      requestId: String(deployment.id),
      status: statusFromReadyState((deployment.readyState as string | null) ?? null),
      url: (deployment.url as string | null) ?? null,
    };
  }

  async getDeployment(requestId: string): Promise<CreatedDeployment> {
    const deployment = await this.request<Record<string, unknown>>(`/v13/deployments/${requestId}`);
    return {
      requestId,
      status: statusFromReadyState((deployment.readyState as string | null) ?? null),
      url: (deployment.url as string | null) ?? null,
    };
  }

  async cancelDeployment(requestId: string): Promise<void> {
    await this.request<Record<string, unknown>>(`/v13/deployments/${requestId}/cancel`, { method: "POST" });
  }
}

/** Honest unavailable deployment provider shown when credentials are absent. */
export class UnavailableDeploymentProvider implements DeploymentProvider {
  readonly id = "unavailable";
  status(): DeploymentProviderStatus {
    return {
      configured: false,
      id: this.id,
      label: "Deployment provider",
      reason: "VERCEL_TOKEN and VERCEL_PROJECT_ID are not configured, so deployments are disabled.",
    };
  }
  async createDeployment(): Promise<CreatedDeployment> {
    throw new AppError("unavailable", "The deployment provider is not configured.", 503);
  }
  async getDeployment(): Promise<CreatedDeployment> {
    throw new AppError("unavailable", "The deployment provider is not configured.", 503);
  }
  async cancelDeployment(): Promise<void> {
    throw new AppError("unavailable", "The deployment provider is not configured.", 503);
  }
}

function tokenFromEnv(): string | undefined {
  return process.env.VERCEL_TOKEN;
}

/** True when server-side deployment/secrets credentials are present. */
export function deploymentCredentialsConfigured(): boolean {
  return Boolean(tokenFromEnv() && process.env.VERCEL_PROJECT_ID);
}

/** Credentials for pushing environment secrets (never exposes the token). */
export function vercelEnvClient(): { token: string; projectId: string; orgId?: string } | null {
  const token = tokenFromEnv();
  if (!token || !process.env.VERCEL_PROJECT_ID) return null;
  return { token, projectId: process.env.VERCEL_PROJECT_ID, orgId: process.env.VERCEL_ORG_ID };
}

/** Returns the active deployment provider (never fakes anything). */
export function getDeploymentProvider(): DeploymentProvider {
  const token = tokenFromEnv();
  if (token && process.env.VERCEL_PROJECT_ID) {
    const filesSource =
      process.env.CLOUD_EXECUTION_WORKER_URL
        ? remoteWorkspaceFileReader(getWorkspaceProvider())
        : undefined;
    return new VercelDeploymentProvider(
      token,
      process.env.VERCEL_PROJECT_ID,
      process.env.VERCEL_ORG_ID,
      filesSource
    );
  }
  return new UnavailableDeploymentProvider();
}

export function deploymentProviderStatus(): DeploymentProviderStatus {
  return getDeploymentProvider().status();
}

/**
 * Pushes an environment secret to the Vercel project's encrypted env store.
 * The secret value is only used in-flight; the Cloud Development database
 * stores metadata (name + configured flag) — never the value.
 */
export async function vercelSetEnvVariable(
  token: string,
  projectId: string,
  orgId: string | undefined,
  name: string,
  value: string
): Promise<void> {
  const teamId = orgId ? `?teamId=${encodeURIComponent(orgId)}` : "";
  const res = await fetch(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}/env${teamId}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        key: name,
        type: "encrypted",
        value,
        targets: ["production", "preview", "development"],
      }),
    }
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new AppError(
      "unavailable",
      `Vercel env error (${res.status}): ${body?.message ?? "Unknown provider error."}`,
      502
    );
  }
}