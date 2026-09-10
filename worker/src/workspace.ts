import fs from "node:fs";
import path from "node:path";
import { ForbiddenError, ValidationError } from "../../src/server/errors";
import { isSensitivePath } from "../../src/server/cloud/paths";

/**
 * Working-directory confinement for the Cloud Execution worker.
 *
 * A client-supplied `cwd` is never trusted as an OS path. It is resolved
 * against the worker's own configured workspace root, verified to stay inside
 * it (path.relative), and re-verified against the real paths (so a symlink or
 * junction cannot smuggle the process outside the root). Protected paths
 * (.env, .git, .ssh, keys) are rejected even when technically inside the root.
 *
 * `cwd` may be:
 *   - an absolute path inside the workspace root (existing contract), or
 *   - a relative path, resolved against the workspace root. This lets the app
 *     address a workspace without ever knowing the worker's real root (e.g. a
 *     remote provider passes the project id as the root handle).
 */
export function assertCwdInsideWorkspace(workspaceRoot: string, cwd: string): string {
  if (typeof cwd !== "string" || cwd.length === 0) {
    throw new ValidationError("Working directory is required.");
  }
  if (cwd.length > 1024) {
    throw new ValidationError("Working directory is too long.");
  }

  const root = path.resolve(workspaceRoot);
  const trimmed = cwd.trim();
  let candidate: string;
  if (trimmed === "" || trimmed === "." || trimmed === "./") {
    candidate = root;
  } else if (!path.isAbsolute(cwd)) {
    candidate = path.resolve(root, cwd);
  } else {
    candidate = path.resolve(cwd);
  }

  assertContained(root, candidate, "Working directory escapes the execution workspace.");

  const rel = path.relative(root, candidate);
  if (rel !== "" && isProtectedCwd(rel)) {
    throw new ForbiddenError("Working directory is protected.");
  }

  let realRoot: string;
  let realCwd: string;
  try {
    realRoot = fs.realpathSync(root);
    realCwd = fs.realpathSync(candidate);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ValidationError("The working directory does not exist.");
    }
    throw err;
  }
  assertContained(realRoot, realCwd, "Working directory escapes the execution workspace.");
  return candidate;
}

function assertContained(root: string, candidate: string, message: string): void {
  const rel = path.relative(root, candidate);
  if (rel === "") return;
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new ForbiddenError(message);
  }
}

/** Directories a command may never run from, even inside the workspace root. */
const PROTECTED_CWD_COMPONENTS = new Set([".git", ".ssh", ".vercel", ".npmrc"]);

function isProtectedCwd(rel: string): boolean {
  const parts = rel.replace(/\\/g, "/").split("/").filter((part) => part.length > 0 && part !== ".");
  if (parts.some((part) => PROTECTED_CWD_COMPONENTS.has(part) || part.startsWith(".env"))) {
    return true;
  }
  return isSensitivePath(rel);
}