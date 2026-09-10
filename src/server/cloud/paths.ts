import os from "node:os";
import path from "node:path";
import { ForbiddenError, ValidationError } from "../errors";

/**
 * Workspace path security for the Cloud Development environment.
 *
 * Every user-supplied relative path is normalized and re-validated against the
 * project's workspace root. Nothing from the client is ever used as a raw OS
 * path; all FS access funnels through assertInsideWorkspace().
 */

/** Where per-project workspaces live. Overridable for the local worker. */
export const CLOUD_WORKSPACE_ROOT = path.resolve(
  process.env.CLOUD_WORKSPACE_ROOT ?? path.join(os.tmpdir(), "chatr-cloud-workspaces")
);

const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates a project identifier (a UUID) and returns it unchanged. */
export function assertProjectId(projectId: string): string {
  if (typeof projectId !== "string" || !PROJECT_ID_PATTERN.test(projectId)) {
    throw new ValidationError("Invalid project identifier.");
  }
  return projectId;
}

/**
 * Stable, per-project workspace directory. The project id is a UUID from the
 * database (never user text), but it is still validated before touching disk.
 */
export function projectWorkspaceDir(projectId: string): string {
  return path.join(CLOUD_WORKSPACE_ROOT, assertProjectId(projectId));
}

/**
 * Resolves a client-supplied relative path inside `root`, throwing when the
 * result would escape the root (traversal / absolute path / drive letter on
 * Windows). Returns the absolute path. `relPath` uses forward slashes and may
 * be "." or empty to mean the root itself.
 */
export function assertInsideWorkspace(root: string, relPath: string): string {
  const cleaned = normalizeRelPath(relPath);
  const abs = path.resolve(root, ...cleaned.map((part) => part));
  const relative = path.relative(root, abs);
  if (relative === "") return abs;
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ForbiddenError("Path escapes the project workspace.");
  }
  return abs;
}

/** Splits and sanitizes a relative path string into safe, normal parts. */
export function normalizeRelPath(relPath: string): string[] {
  if (typeof relPath !== "string" || relPath.length > 1024) {
    throw new ValidationError("Invalid path.");
  }
  if (relPath === "." || relPath === "") return [];
  // Convert backslashes (defensive on Windows), drop empty and dot segments.
  return relPath
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part.length > 0 && part !== ".");
}

/**
 * Sensitive path names that are never served, written, renamed, or deleted
 * through the Cloud Development file API. Matched against a normalized
 * forward-slash relative path.
 */
const SENSITIVE_PATH_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.env(\.[a-zA-Z0-9_-]+)?$/,
  /(^|\/)\.env\.local$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)(id_rsa|id_ed25519|id_dsa)(\.pub)?$/,
  /\.(pem|p12|pfx|key|p8|crt|der)$/i,
  /(^|\/)\.ssh\//,
  /(^|\/)\.git\//,
  /(^|\/)\.vercel\//,
];

/** True when a relative path must be rejected by the file API. */
export function isSensitivePath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Content patterns that must never appear in a build path's visible output or
 * persisted metadata (service-role keys, tokens, private keys).
 */
export const SECRET_CONTENT_PATTERNS: readonly RegExp[] = [
  /AKIA[0-9A-Z]{16}/,
  /(ghp|gho|ghu|github_pat)_[0-9A-Za-z]{20,}/,
  /AIza[0-9A-Za-z_-]{30,}/,
  /sk-[0-9A-Za-z]{16,}/,
  /xox[baprs]-[0-9A-Za-z-]{10,}/,
  /BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY/,
  /(api[_-]?key|secret|token|password)\s*[:=]\s*['"`]?[0-9A-Za-z_\-\.]{12,}/i,
];

/** True when a text blob looks like it contains credentials. */
export function containsSecretContent(text: string): boolean {
  return SECRET_CONTENT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Replaces credential-looking material in a text blob for safe persistence or
 * display. Every known secret pattern is masked, so a build log or command
 * output that echoes an API key, token, or private key is stored/streamed
 * without the secret value.
 */
export function redactSecretContent(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_CONTENT_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

/** Max bytes of a single text file the file API reads or writes. */
export const MAX_TEXT_FILE_BYTES = 1_000_000;
/** Cap on directory entries returned by one list/search call. */
export const MAX_LISTING_ENTRIES = 2000;