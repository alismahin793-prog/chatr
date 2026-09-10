import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { supabaseErrorToAppError } from "@/server/data/errors";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { SUPER_ADMIN_ROLE } from "@/server/admin/security";
import type { AccountStatus } from "@/server/auth/capabilities";

/**
 * Registration-approval lifecycle: server-side (service role) management of
 * the profiles.status field for interactive accounts.
 *
 *   pending  -> signed up, blocked until approved
 *   approved -> can use the app
 *   rejected / disabled -> blocked
 *
 * Security boundary:
 *   * Every write here uses the service role ONLY.
 *   * The super_admin owner can never be rejected, disabled, or deleted by
 *     any other account (including other admins) — enforced BEFORE the write.
 *   * Test users (profile.role === "user" AND is_test_user) are managed by
 *     the dedicated test-user flow, but this path still works for them via
 *     the shared profiles.status column.
 */

export const APPROVABLE_PARAM_VALUES = ["pending", "approved", "rejected", "disabled"] as const;
export const APPROVAL_TARGET_STATUSES = ["approved", "rejected", "disabled"] as const;

export type ApprovalTargetStatus = (typeof APPROVAL_TARGET_STATUSES)[number];

export interface ApprovalSummary {
  id: string;
  email: string;
  displayName: string | null;
  role: string | null;
  status: AccountStatus;
  isTestUser: boolean;
  createdAt: string;
}

const PROFILE_FIELDS =
  "id, display_name, role, status, is_test_user, created_at";

type ProfileData = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "display_name" | "role" | "status" | "is_test_user" | "created_at"
>;

function toSummary(
  profile: ProfileData,
  email: string
): ApprovalSummary {
  return {
    id: profile.id,
    email,
    displayName: profile.display_name,
    role: profile.role,
    status: profile.status,
    isTestUser: profile.is_test_user,
    createdAt: profile.created_at,
  };
}

async function emailForUser(
  service: SupabaseClient<Database>,
  userId: string
): Promise<string> {
  const { data, error } = await service.auth.admin.getUserById(userId);
  if (error) throw supabaseErrorToAppError(error);
  return data.user?.email ?? "";
}

async function loadProfileOrThrow(
  service: SupabaseClient<Database>,
  userId: string
): Promise<ProfileData> {
  const { data, error } = await service
    .from("profiles")
    .select(PROFILE_FIELDS)
    .eq("id", userId)
    .maybeSingle();
  if (error) throw supabaseErrorToAppError(error);
  if (!data) throw new NotFoundError("Account not found.");
  return data;
}

/**
 * Lists accounts by their lifecycle status (service-role read for the admin
 * "Approvals" screen). Emails come from the Auth admin list, mapped once.
 */
export async function listAccountsByStatus(
  service: SupabaseClient<Database>,
  statuses: readonly ApprovalSummary["status"][]
): Promise<ApprovalSummary[]> {
  if (statuses.length === 0) return [];

  const { data: profiles, error: profileError } = await service
    .from("profiles")
    .select(PROFILE_FIELDS)
    .in("status", [...statuses])
    .order("created_at", { ascending: false });
  if (profileError) throw supabaseErrorToAppError(profileError);

  const { data: authUsers, error: authError } = await service.auth.admin.listUsers();
  if (authError) throw supabaseErrorToAppError(authError);
  const emailById = new Map(
    authUsers?.users?.map((u) => [u.id, u.email ?? ""]) ?? []
  );

  return (profiles ?? []).map((profile) =>
    toSummary(profile, emailById.get(profile.id) ?? "")
  );
}

/**
 * Sets the registration-approval status of an account (approve / reject /
 * disable). The super_admin owner is protected here: nothing may push it to
 * pending/rejected/disabled through this path.
 */
export async function setAccountStatus(
  service: SupabaseClient<Database>,
  userId: string,
  status: ApprovalTargetStatus
): Promise<ApprovalSummary> {
  const profile = await loadProfileOrThrow(service, userId);

  if (profile.role === SUPER_ADMIN_ROLE) {
    throw new ForbiddenError(
      "The super_admin account cannot be rejected, disabled, or deleted."
    );
  }

  if (profile.status === status) {
    return toSummary(profile, await emailForUser(service, userId));
  }

  const { error } = await service
    .from("profiles")
    .update({ status })
    .eq("id", userId);
  if (error) throw supabaseErrorToAppError(error);

  const refreshed = await loadProfileOrThrow(service, userId);
  return toSummary(refreshed, await emailForUser(service, userId));
}