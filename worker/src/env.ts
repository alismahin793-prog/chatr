import { buildSpawnEnv } from "../../src/server/cloud/execution/LocalExecutionProvider";
import { ValidationError } from "../../src/server/errors";

/**
 * Environment policy for the Cloud Execution worker.
 *
 * A child process inherits ONLY the host variables explicitly allowed by the
 * shared buildSpawnEnv allowlist, plus the explicit request variables. Worker
 * secrets and any secret-looking variable are rejected outright so a build
 * script can never read or echo them. Structural variables (PATH, ComSpec, …)
 * cannot be overridden, which stops a request from redirecting the spawned
 * executable to a hijacked binary inside the workspace.
 */

const DENIED_ENV_KEYS = new Set([
  "CLOUD_EXECUTION_WORKER_TOKEN",
  "CLOUD_EXECUTION_WORKER_URL",
  "CLOUD_WORKER_WORKSPACE_ROOT",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
  "SUPABASE_JWT_SECRET",
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "DIRECT_URL",
  "VERCEL_TOKEN",
  "VERCEL_ORG_ID",
  "NPM_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
]);

const STRUCTURAL_ENV_KEYS = new Set([
  "PATH",
  "PATHEXT",
  "ComSpec",
  "SystemRoot",
  "SystemDrive",
  "WINDIR",
  "ProgramFiles",
  "ProgramFiles(x86)",
]);

/** Secret-looking names are always rejected, regardless of the literal name. */
const SECRET_NAME_PATTERN = /(token|secret|passwd|password|api[_-]?key|credential)/i;

/**
 * Validates and builds the child process environment. Throws a
 * ValidationError for any variable the worker must not hand to a child.
 */
export function buildChildEnv(explicit?: Record<string, string>): NodeJS.ProcessEnv {
  if (!explicit) return buildSpawnEnv();
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(explicit)) {
    if (DENIED_ENV_KEYS.has(key)) {
      throw new ValidationError(`Environment variable "${key}" is reserved.`);
    }
    if (STRUCTURAL_ENV_KEYS.has(key)) {
      throw new ValidationError(`Environment variable "${key}" cannot be overridden.`);
    }
    if (SECRET_NAME_PATTERN.test(key)) {
      throw new ValidationError(`Environment variable "${key}" is not allowed.`);
    }
    safe[key] = value;
  }
  return buildSpawnEnv(safe);
}