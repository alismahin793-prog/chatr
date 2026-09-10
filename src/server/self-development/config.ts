/**
 * Configuration for the Self-Development Engine. Every knob has a safe
 * default; nothing here reads or exposes secret values.
 *
 * Env vars (names only, documented in docs/self-development.md):
 * - ALLOW_PRODUCTION_SELF_MODIFICATION  default "false" — even when "true",
 *   the engine never bypasses the human deploy-approval gate.
 * - MAX_REPAIR_ATTEMPTS                 default 3 — bounded repair loop.
 * - SELF_DEVELOPMENT_TIMEOUT_MS         default 30 minutes.
 * - SELF_DEVELOPMENT_MAX_FILES_CHANGED  default 50.
 */

export const DEFAULT_MAX_REPAIR_ATTEMPTS = 3;
export const DEFAULT_SELF_DEVELOPMENT_TIMEOUT_MS = 30 * 60_000;
export const DEFAULT_MAX_FILES_CHANGED = 50;

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Block the engine from deploying to production until an operator opts in. */
export function allowProductionSelfModification(): boolean {
  return process.env.ALLOW_PRODUCTION_SELF_MODIFICATION === "true";
}

/** Maximum automatic repair cycles before the request fails. */
export function maxRepairAttempts(): number {
  return intFromEnv("MAX_REPAIR_ATTEMPTS", DEFAULT_MAX_REPAIR_ATTEMPTS);
}

/** Hard wall-clock budget for a single development run. */
export function selfDevelopmentTimeoutMs(): number {
  return intFromEnv("SELF_DEVELOPMENT_TIMEOUT_MS", DEFAULT_SELF_DEVELOPMENT_TIMEOUT_MS);
}

/** Maximum number of file operations a single AI change proposal may contain. */
export function maxFilesChanged(): number {
  return intFromEnv("SELF_DEVELOPMENT_MAX_FILES_CHANGED", DEFAULT_MAX_FILES_CHANGED);
}

/**
 * Trusted public base URL used for post-deploy /api/health verification.
 * Comes from the environment only (never user input) so SSRF cannot steer it.
 */
export function appPublicBaseUrl(): string | undefined {
  const raw = process.env.APP_PUBLIC_BASE_URL?.trim();
  if (!raw) return undefined;
  try {
    new URL(raw);
    return raw;
  } catch {
    return undefined;
  }
}