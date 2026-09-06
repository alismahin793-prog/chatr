import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/service";
import { requireUser } from "@/server/api/helpers";
import { supabaseErrorToAppError } from "@/server/data/errors";
import { AdminReauthRequiredError, ForbiddenError } from "@/server/errors";

export const ADMIN_ROLE = "admin";
export const USER_ROLE = "user";

/** How long a verified admin stays privileged before re-authentication. */
export const ADMIN_SESSION_TTL_SECONDS = 30;
export const ADMIN_SESSION_TTL_MS = ADMIN_SESSION_TTL_SECONDS * 1000;

export interface AdminIdentityContext {
  supabase: SupabaseClient<Database>;
  service: SupabaseClient<Database>;
  user: User;
  profile: {
    role: string | null;
    admin_verified_at: string | null;
    display_name: string | null;
  };
}

export interface AdminContext extends AdminIdentityContext {
  verifiedAt: string | null;
  expiresAt: string;
}

export type AdminWindowStatus = "active" | "expired" | "never";

/**
 * Pure check of the 30-second admin re-authentication window.
 * An admin is privileged only when they verified their password within the
 * last ADMIN_SESSION_TTL_MS. `now` is injectable for deterministic tests.
 */
export function adminWindowStatus(
  verifiedAt: string | null,
  now = Date.now()
): AdminWindowStatus {
  if (!verifiedAt) return "never";
  const verified = Date.parse(verifiedAt);
  if (Number.isNaN(verified)) return "never";
  return now - verified <= ADMIN_SESSION_TTL_MS ? "active" : "expired";
}

async function loadAdminProfile(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<AdminIdentityContext["profile"]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("role, admin_verified_at, display_name")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw supabaseErrorToAppError(error);
  return data ?? { role: null, admin_verified_at: null, display_name: null };
}

/**
 * Authorizes the caller as an admin ON THE SERVER (never client-side): the
 * user must be signed in AND hold the "admin" role in their profile. This
 * does not check the re-authentication window — it is the gate used by the
 * re-authentication endpoint itself.
 *
 * Every future admin API route must start with requireAdmin() or
 * requireAdminIdentity(); never rely on the UI to block access.
 */
export async function requireAdminIdentity(): Promise<AdminIdentityContext> {
  const { supabase, user } = await requireUser();
  const profile = await loadAdminProfile(supabase, user.id);
  if (profile.role !== ADMIN_ROLE) {
    throw new ForbiddenError("Admin privileges required.");
  }
  return { supabase, service: createServiceClient(), user, profile };
}

/**
 * Full admin gate for protected routes: identity (see requireAdminIdentity)
 * plus an active re-authentication window. Throws AdminReauthRequiredError
 * when the admin has not re-authenticated within the last 30 seconds.
 */
export async function requireAdmin(): Promise<AdminContext> {
  const identity = await requireAdminIdentity();
  const status = adminWindowStatus(identity.profile.admin_verified_at);
  if (status !== "active") {
    throw new AdminReauthRequiredError();
  }
  const verifiedAt = identity.profile.admin_verified_at;
  const expiresAt = new Date(
    Date.parse(verifiedAt as string) + ADMIN_SESSION_TTL_MS
  ).toISOString();
  return { ...identity, verifiedAt, expiresAt };
}

/**
 * Records successful admin re-authentication. Only reachable through the
 * service role after a password check passed, so tenants cannot forge it.
 */
export async function markAdminVerified(
  service: SupabaseClient<Database>,
  userId: string,
  verifiedAt = new Date().toISOString()
): Promise<void> {
  const { error } = await service
    .from("profiles")
    .update({ admin_verified_at: verifiedAt })
    .eq("id", userId);
  if (error) throw supabaseErrorToAppError(error);
}

/** Revokes admin elevation (e.g. on logout or after a failed re-auth). */
export async function clearAdminVerified(
  service: SupabaseClient<Database>,
  userId: string
): Promise<void> {
  const { error } = await service
    .from("profiles")
    .update({ admin_verified_at: null })
    .eq("id", userId);
  if (error) throw supabaseErrorToAppError(error);
}

export type PasswordCheckResult = { ok: true } | { ok: false };

/**
 * Verifies the user's Supabase account password server-side using GoTrue.
 * The password is never stored, logged, or returned; it exists only in
 * memory for the duration of the sign-in call.
 */
export async function verifyPassword(
  supabase: SupabaseClient<Database>,
  email: string,
  password: string
): Promise<PasswordCheckResult> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? { ok: false } : { ok: true };
}