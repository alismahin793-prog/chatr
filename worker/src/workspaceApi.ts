import fs from "node:fs";
import path from "node:path";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../src/server/errors";
import {
  assertInsideWorkspace,
  assertProjectId,
  isSensitivePath,
  MAX_LISTING_ENTRIES,
  MAX_TEXT_FILE_BYTES,
  normalizeRelPath,
} from "../../src/server/cloud/paths";
import type { FileEntity } from "../../src/server/cloud/types";

/**
 * File/workspace operations for the Cloud Execution worker.
 *
 * These are the ONLY file endpoints the worker exposes. Every path is a
 * validated relative path resolved inside the project's own directory under
 * the persistent volume root — one request can never address another request's
 * workspace. Sensitive paths (.env*, .git internals, keys, certs, .ssh, …) are
 * refused, and a realpath check re-verifies that a symlink or junction cannot
 * smuggle a read/write/rename/delete outside the workspace.
 *
 * Nothing here is logged with file content, and responses never include worker
 * configuration or secrets.
 */

const BINARY_SNIFF_BYTES = 8192;
const WALK_MAX_DEPTH = 64;
const SEARCH_MAX_DEPTH = 6;

/** Absolute path of a project's isolated workspace directory (volume-owned). */
export function workspaceDirFor(root: string, projectId: string): string {
  return path.join(path.resolve(root), assertProjectId(projectId));
}

/** Ensures the project workspace directory exists on the volume. */
export async function ensureWorkspaceDir(root: string, projectId: string): Promise<string> {
  const wsRoot = workspaceDirFor(root, projectId);
  await fs.promises.mkdir(wsRoot, { recursive: true });
  return wsRoot;
}

interface ConfinedTarget {
  rel: string;
  abs: string;
}

/**
 * Resolves a client-relative path inside a project workspace and re-verifies
 * against the real paths so a symlink/junction cannot escape the workspace.
 */
function resolveWithinWorkspace(workspaceRoot: string, relPath: string, allowRoot = false): ConfinedTarget {
  const rel = normalizeRelPath(relPath).join("/");
  if (rel.length === 0 && !allowRoot) {
    throw new ValidationError("A path is required.");
  }
  if (isSensitivePath(rel)) {
    throw new ForbiddenError("This path is sensitive.");
  }
  const abs = assertInsideWorkspace(workspaceRoot, relPath);
  const realAbs = assertRealpathContained(path.resolve(workspaceRoot), abs);
  return { rel, abs: realAbs };
}

/** Realpath-verifies `abs` (or its deepest existing ancestor) stays inside root. */
function assertRealpathContained(workspaceRootAbs: string, abs: string): string {
  let rootReal: string;
  try {
    rootReal = fs.realpathSync(workspaceRootAbs);
  } catch {
    throw new ValidationError("The workspace root is unavailable.");
  }
  const suffix: string[] = [];
  let probe = abs;
  let probeReal: string;
  for (;;) {
    try {
      probeReal = fs.realpathSync(probe);
      break;
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) {
        throw new ValidationError("The path cannot be resolved.");
      }
      suffix.unshift(path.basename(probe));
      probe = parent;
    }
  }
  const resolved = path.join(probeReal, ...suffix);
  const rel = path.relative(rootReal, resolved);
  if (rel !== "" && (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))) {
    throw new ForbiddenError("Path escapes the workspace.");
  }
  return resolved;
}

function mapFsError(err: unknown, fallback: string, missing: string): never {
  if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
    throw new NotFoundError(missing);
  }
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === "EACCES" || code === "EPERM" || code === "ELOOP") {
    throw new ForbiddenError("The path is not accessible.");
  }
  throw new ValidationError(fallback);
}

async function statOrMissing(abs: string): Promise<fs.BigIntStats | fs.Stats> {
  try {
    return await fs.promises.stat(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new NotFoundError("Path not found.");
    }
    throw err;
  }
}

export async function listDir(
  root: string,
  projectId: string,
  relPath: string,
  depth: number | undefined
): Promise<FileEntity[]> {
  const wsRoot = path.resolve(workspaceDirFor(root, projectId));
  const target = resolveWithinWorkspace(wsRoot, relPath, true);
  const stat = await statOrMissing(target.abs);
  if (!stat.isDirectory()) throw new ValidationError("Not a directory.");
  const maxDepth = typeof depth === "number" && Number.isInteger(depth) && depth >= 0 && depth <= WALK_MAX_DEPTH
    ? depth
    : 1;
  const acc: FileEntity[] = [];
  await walk(target.abs, target.rel, maxDepth, 0, acc);
  return acc;
}

async function walk(dir: string, rel: string, maxDepth: number, depth: number, acc: FileEntity[]): Promise<void> {
  if (depth > maxDepth || acc.length >= MAX_LISTING_ENTRIES) return;
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (acc.length >= MAX_LISTING_ENTRIES) return;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    const childAbs = path.join(dir, entry.name);
    let size: number | null = null;
    if (entry.isFile()) {
      try {
        size = (await fs.promises.stat(childAbs)).size;
      } catch {
        size = null;
      }
    }
    acc.push({ name: entry.name, path: childRel, type: entry.isDirectory() ? "dir" : "file", size });
    if (entry.isDirectory() && depth < maxDepth) {
      await walk(childAbs, childRel, maxDepth, depth + 1, acc);
    }
  }
}

export async function readFile(
  root: string,
  projectId: string,
  relPath: string
): Promise<{ path: string; content: string; size: number }> {
  const wsRoot = path.resolve(workspaceDirFor(root, projectId));
  const target = resolveWithinWorkspace(wsRoot, relPath);
  const stat = await statOrMissing(target.abs);
  if (!stat.isFile()) throw new ValidationError("Not a file.");
  const size = Number(stat.size);
  if (size > MAX_TEXT_FILE_BYTES) {
    throw new ValidationError(
      `File is too large to open (max ${Math.round(MAX_TEXT_FILE_BYTES / 1024)} KB).`
    );
  }
  const handle = await fs.promises.open(target.abs, "r");
  try {
    const buffer = Buffer.alloc(size || 1);
    await handle.read(buffer, 0, buffer.length, 0);
    if (buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
      throw new ValidationError("Binary files cannot be opened in the editor.");
    }
    return { path: target.rel, content: buffer.toString("utf8"), size };
  } finally {
    await handle.close();
  }
}

export async function writeFile(
  root: string,
  projectId: string,
  relPath: string,
  content: string
): Promise<{ path: string; size: number }> {
  const wsRoot = path.resolve(workspaceDirFor(root, projectId));
  const target = resolveWithinWorkspace(wsRoot, relPath);
  if (target.rel.length === 0) throw new ValidationError("A file path is required.");
  if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > MAX_TEXT_FILE_BYTES) {
    throw new ValidationError("File content is too large.");
  }
  const dir = path.dirname(target.abs);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(target.abs, content, "utf8");
  } catch (err) {
    mapFsError(err, "Could not write the file.", "The target directory could not be created.");
  }
  return { path: target.rel, size: Buffer.byteLength(content, "utf8") };
}

export async function createDir(root: string, projectId: string, relPath: string): Promise<void> {
  const wsRoot = path.resolve(workspaceDirFor(root, projectId));
  const target = resolveWithinWorkspace(wsRoot, relPath);
  if (target.rel.length === 0) throw new ValidationError("A directory path is required.");
  try {
    await fs.promises.mkdir(target.abs, { recursive: false });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "EEXIST") {
      throw new ValidationError("Directory already exists.");
    }
    mapFsError(err, "Could not create the directory.", "The parent directory does not exist.");
  }
}

export async function renamePath(root: string, projectId: string, from: string, to: string): Promise<void> {
  const wsRoot = path.resolve(workspaceDirFor(root, projectId));
  const source = resolveWithinWorkspace(wsRoot, from);
  const destination = resolveWithinWorkspace(wsRoot, to);
  if (source.rel.length === 0 || destination.rel.length === 0) {
    throw new ValidationError("Both paths are required.");
  }
  try {
    await fs.promises.rename(source.abs, destination.abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "EEXIST") {
      throw new ValidationError("Destination already exists.");
    }
    mapFsError(err, "Could not rename the path.", "Source path not found.");
  }
}

export async function deletePath(
  root: string,
  projectId: string,
  relPath: string,
  recursive: boolean | undefined
): Promise<void> {
  const wsRoot = path.resolve(workspaceDirFor(root, projectId));
  const target = resolveWithinWorkspace(wsRoot, relPath);
  if (target.rel.length === 0) throw new ValidationError("A path is required.");
  const stat = await fs.promises.lstat(target.abs).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") throw new NotFoundError("Path not found.");
    throw err;
  });
  if (stat.isDirectory() && !recursive) {
    const contents = await fs.promises.readdir(target.abs).catch(() => []);
    if (contents.length > 0) {
      throw new ValidationError("Directory is not empty. Remove its contents first.");
    }
  }
  try {
    await fs.promises.rm(target.abs, { recursive: recursive ?? false, force: false });
  } catch (err) {
    mapFsError(err, "Could not delete the path.", "Path not found.");
  }
}

export async function search(root: string, projectId: string, query: string): Promise<FileEntity[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const wsRoot = path.resolve(workspaceDirFor(root, projectId));
  const acc: FileEntity[] = [];
  await walkForSearch(wsRoot, [], acc, q, 0);
  return acc.slice(0, MAX_LISTING_ENTRIES);
}

async function walkForSearch(
  dir: string,
  relParts: string[],
  acc: FileEntity[],
  query: string,
  depth: number
): Promise<void> {
  if (depth > SEARCH_MAX_DEPTH || acc.length >= MAX_LISTING_ENTRIES) return;
  let entries: fs.Dirent[];
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
    if (isDir && depth < SEARCH_MAX_DEPTH) {
      await walkForSearch(path.join(dir, entry.name), [...relParts, entry.name], acc, query, depth + 1);
    }
  }
}