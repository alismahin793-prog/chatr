import fs from "node:fs";
import path from "node:path";
import type {
  ExecutionProviderStatus,
  FileEntity,
  WorkspaceProvider,
} from "@/server/cloud/types";
import {
  assertInsideWorkspace,
  containsSecretContent,
  isSensitivePath,
  MAX_LISTING_ENTRIES,
  MAX_TEXT_FILE_BYTES,
  projectWorkspaceDir,
  normalizeRelPath,
} from "@/server/cloud/paths";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { assertProjectId } from "@/server/cloud/paths";
import { workerConfigured, workerPost } from "@/server/cloud/workerClient";

/**
 * Local workspace provider. Each project maps to its own directory under
 * CLOUD_WORKSPACE_ROOT; paths are re-validated on every call, sensitive files
 * are refused, binary files are refused, and every read/write honors a size
 * cap. This is the dev/test implementation; the worker runs the same
 * interface when CLOUD_EXECUTION_WORKER_URL is configured.
 */

const BINARY_SNIFF_BYTES = 8192;
const WORKER_OP_TIMEOUT_MS = 60_000;

/**
 * Remote workspace provider. In remote mode the "root" is an opaque handle —
 * the project id — because the worker owns the filesystem and resolves every
 * path against its own volume. Each of these calls hits the worker's
 * authenticated file endpoints, which confine every operation to the project's
 * own directory and refuse sensitive paths, traversal and symlink escapes.
 */
export class RemoteWorkspaceProvider implements WorkspaceProvider {
  readonly id = "remote-workspace";

  status(): ExecutionProviderStatus {
    if (!workerConfigured()) {
      return {
        configured: false,
        id: this.id,
        label: "Remote workspace",
        description: "Per-project workspace directories on the Cloud Development worker volume.",
        reason: "CLOUD_EXECUTION_WORKER_URL/TOKEN are not configured.",
      };
    }
    return {
      configured: true,
      id: this.id,
      label: "Remote workspace",
      description: "Per-project workspace directories on the Cloud Development worker volume.",
    };
  }

  resolveRoot(projectId: string): string {
    return assertProjectId(projectId);
  }

  private async post<T>(root: string, path: string, body: unknown): Promise<T> {
    return workerPost<T>(`/workspaces/${root}${path}`, body, {
      timeoutMs: WORKER_OP_TIMEOUT_MS,
      label: "workspace operation",
    });
  }

  async listDir(root: string, relPath: string, options?: { depth?: number }): Promise<FileEntity[]> {
    const { entities } = await this.post<{ entities: FileEntity[] }>(root, "/files/list", {
      path: relPath,
      depth: options?.depth,
    });
    return entities;
  }

  async readFile(root: string, relPath: string): Promise<{ path: string; content: string; size: number }> {
    return this.post(root, "/files/read", { path: relPath });
  }

  async writeFile(root: string, relPath: string, content: string): Promise<{ path: string; size: number }> {
    return this.post(root, "/files/write", { path: relPath, content });
  }

  async createDir(root: string, relPath: string): Promise<void> {
    await this.post(root, "/dirs/create", { path: relPath });
  }

  async renamePath(root: string, from: string, to: string): Promise<void> {
    await this.post(root, "/paths/rename", { from, to });
  }

  async deletePath(root: string, relPath: string, options?: { recursive?: boolean }): Promise<void> {
    await this.post(root, "/paths/delete", { path: relPath, recursive: options?.recursive });
  }

  async search(root: string, query: string): Promise<FileEntity[]> {
    const { entities } = await this.post<{ entities: FileEntity[] }>(root, "/files/search", { query });
    return entities;
  }
}

export function decodeBase64UrlOrThrow(raw: string): string {
  try {
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    throw new ValidationError("Invalid file content encoding.");
  }
}

export class LocalWorkspaceProvider implements WorkspaceProvider {
  readonly id = "local-workspace";

  status(): ExecutionProviderStatus {
    return {
      configured: true,
      id: this.id,
      label: "Local workspace",
      description: "Per-project workspace directories on this host.",
    };
  }

  resolveRoot(projectId: string): string {
    const dir = projectWorkspaceDir(projectId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  async listDir(root: string, relPath: string, options?: { depth?: number }): Promise<FileEntity[]> {
    const target = assertInsideWorkspace(root, relPath);
    const maxDepth = options?.depth ?? 1;
    const stat = await fs.promises.stat(target);
    if (!stat.isDirectory()) throw new ValidationError("Not a directory.");
    return this.walk(target, root, normalizeRelPath(relPath), maxDepth, 0, []);
  }

  private async walk(
    dir: string,
    root: string,
    relParts: string[],
    maxDepth: number,
    depth: number,
    acc: FileEntity[]
  ): Promise<FileEntity[]> {
    if (depth > maxDepth) return acc;
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (acc.length >= MAX_LISTING_ENTRIES) return acc;
      const rel = [...relParts, entry.name].join("/");
      const abs = path.join(dir, entry.name);
      let size: number | null = null;
      if (entry.isFile()) {
        try {
          size = (await fs.promises.stat(abs)).size;
        } catch {
          size = null;
        }
      }
      acc.push({ name: entry.name, path: rel, type: entry.isDirectory() ? "dir" : "file", size });
      if (entry.isDirectory() && depth < maxDepth) {
        await this.walk(abs, root, [...relParts, entry.name], maxDepth, depth + 1, acc);
      }
    }
    return acc;
  }

  async readFile(
    root: string,
    relPath: string
  ): Promise<{ path: string; content: string; size: number }> {
    const target = assertInsideWorkspace(root, relPath);
    const safeRel = normalizeRelPath(relPath).join("/");
    if (isSensitivePath(safeRel)) {
      throw new ForbiddenError("This file is sensitive and cannot be opened.");
    }
    const stat = await fs.promises.stat(target);
    if (!stat.isFile()) throw new ValidationError("Not a file.");
    if (stat.size > MAX_TEXT_FILE_BYTES) {
      throw new ValidationError(
        `File is too large to open in the editor (max ${Math.round(MAX_TEXT_FILE_BYTES / 1024)} KB).`
      );
    }
    const handle = await fs.promises.open(target, "r");
    try {
      const buffer = Buffer.alloc(stat.size || 1);
      await handle.read(buffer, 0, buffer.length, 0);
      if (buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
        throw new ValidationError("Binary files cannot be opened in the editor.");
      }
      return { path: safeRel, content: buffer.toString("utf8"), size: stat.size };
    } finally {
      await handle.close();
    }
  }

  async writeFile(root: string, relPath: string, content: string): Promise<{ path: string; size: number }> {
    const safeRel = normalizeRelPath(relPath).join("/");
    if (safeRel.length === 0) throw new ValidationError("A file path is required.");
    if (isSensitivePath(safeRel)) {
      throw new ForbiddenError("This path is sensitive and cannot be modified.");
    }
    if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > MAX_TEXT_FILE_BYTES) {
      throw new ValidationError("File content is too large.");
    }
    const target = assertInsideWorkspace(root, relPath);
    const dir = path.dirname(target);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(target, content, "utf8");
    return { path: safeRel, size: Buffer.byteLength(content, "utf8") };
  }

  async createDir(root: string, relPath: string): Promise<void> {
    const safeRel = normalizeRelPath(relPath).join("/");
    if (safeRel.length === 0) throw new ValidationError("A directory path is required.");
    if (isSensitivePath(safeRel)) {
      throw new ForbiddenError("This path is sensitive and cannot be modified.");
    }
    const target = assertInsideWorkspace(root, relPath);
    await fs.promises.mkdir(target, { recursive: false });
  }

  async renamePath(root: string, from: string, to: string): Promise<void> {
    const safeFrom = normalizeRelPath(from).join("/");
    const safeTo = normalizeRelPath(to).join("/");
    if (isSensitivePath(safeFrom) || isSensitivePath(safeTo)) {
      throw new ForbiddenError("This path is sensitive and cannot be renamed.");
    }
    const source = assertInsideWorkspace(root, from);
    const destination = assertInsideWorkspace(root, to);
    await fs.promises.rename(source, destination);
  }

  async deletePath(root: string, relPath: string, options?: { recursive?: boolean }): Promise<void> {
    const safeRel = normalizeRelPath(relPath).join("/");
    if (safeRel.length === 0) throw new ValidationError("A path is required.");
    if (isSensitivePath(safeRel)) {
      throw new ForbiddenError("This path is sensitive and cannot be deleted.");
    }
    const target = assertInsideWorkspace(root, relPath);
    const stat = await fs.promises.stat(target);
    if (stat.isDirectory() && !options?.recursive) {
      throw new ValidationError("Directory is not empty. Remove its contents first.");
    }
    await fs.promises.rm(target, { recursive: options?.recursive ?? false, force: false });
  }

  async search(root: string, query: string): Promise<FileEntity[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const results: FileEntity[] = [];
    await this.walkForSearch(root, [], results, q, 0);
    return results.slice(0, MAX_LISTING_ENTRIES);
  }

  private async walkForSearch(
    dir: string,
    relParts: string[],
    acc: FileEntity[],
    query: string,
    depth: number
  ): Promise<void> {
    if (depth > 6 || acc.length >= MAX_LISTING_ENTRIES) return;
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (acc.length >= MAX_LISTING_ENTRIES) return;
      const rel = [...relParts, entry.name].join("/");
      if (isSensitivePath(rel)) continue;
      const isDir = entry.isDirectory();
      if (entry.name.toLowerCase().includes(query)) {
        acc.push({ name: entry.name, path: rel, type: isDir ? "dir" : "file", size: null });
      }
      if (isDir && depth < 6) {
        await this.walkForSearch(path.join(dir, entry.name), [...relParts, entry.name], acc, query, depth + 1);
      }
    }
  }
}

let cachedWorkspace: WorkspaceProvider | null = null;

/** True when a worker URL and token are configured (workspace offloaded to the worker). */
export function remoteWorkspaceConfigured(): boolean {
  return workerConfigured();
}

/** Returns the shared workspace provider (remote when a worker URL is set). */
export function getWorkspaceProvider(): WorkspaceProvider {
  if (!cachedWorkspace) {
    cachedWorkspace = process.env.CLOUD_EXECUTION_WORKER_URL
      ? new RemoteWorkspaceProvider()
      : new LocalWorkspaceProvider();
  }
  return cachedWorkspace;
}

/**
 * Content guard used before persisting operation output: refuses output blobs
 * that contain credential-looking material. Never stores or forwards secrets.
 */
export function assertNoSecretContent(output: string, label: string): void {
  if (containsSecretContent(output)) {
    throw new ForbiddenError(`${label} output appears to contain credentials and was not stored.`);
  }
}