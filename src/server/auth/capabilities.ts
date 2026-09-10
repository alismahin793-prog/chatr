import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { supabaseErrorToAppError } from "@/server/data/errors";
import { ForbiddenError } from "@/server/errors";
import { SUPER_ADMIN_ROLE } from "@/lib/shared/roles";

/**
 * Application capabilities granted to TEST users. These map one-to-one to
 * real, server-enforced features of the app:
 *   - chat   : sending messages and managing conversations
 *   - models : choosing/using the configured AI providers and models
 *
 * They are NOT roles and never influence admin authorization: profiles.role
 * is the only source of truth for admin access. Tenants (including test
 * users) may read only their own rows in app_permissions; every write is
 * performed by server code through the service role.
 */
export const CAPABILITIES = {
  CHAT: "chat",
  MODELS: "models",
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

export const ALL_CAPABILITIES: readonly Capability[] = Object.values(CAPABILITIES);

export const CAPABILITY_LABELS: Record<Capability, string> = {
  chat: "Chat",
  models: "AI models",
};

export type AccountStatus =
  | "active"
  | "approved"
  | "pending"
  | "rejected"
  | "disabled";

/**
 * Statuses in which an account may actually use the app. "active" is kept as
 * the legacy value for pre-approval accounts and is treated identically to
 * "approved"; "pending"/"rejected"/"disabled" always block access.
 */
export const APPROVED_STATUSES: readonly AccountStatus[] = ["active", "approved"];

export function isApprovedStatus(status: AccountStatus): boolean {
  return APPROVED_STATUSES.includes(status);
}

export const DISABLED_ACCOUNT_MESSAGE =
  "Your account has been disabled. Please contact the administrator.";

export const PENDING_ACCOUNT_MESSAGE =
  "تم استلام طلب إنشاء حسابك. سيتم مراجعة طلبك من الإدارة.";

export const REJECTED_ACCOUNT_MESSAGE =
  "Your account was not approved. Please contact the administrator.";

export const EXPIRED_ACCOUNT_MESSAGE =
  "Your account has expired. Please contact the administrator.";

/**
 * Maps a blocked status to its user-safe message. Returns null when the
 * status is usable (active/approved). Used by the lifecycle gate, the proxy
 * redirect, and the /pending page.
 */
export function accountStatusMessage(status: AccountStatus): string | null {
  switch (status) {
    case "pending":
      return PENDING_ACCOUNT_MESSAGE;
    case "rejected":
      return REJECTED_ACCOUNT_MESSAGE;
    case "disabled":
      return DISABLED_ACCOUNT_MESSAGE;
    case "active":
    case "approved":
      return null;
  }
}

export function isValidCapability(value: string): value is Capability {
  return (ALL_CAPABILITIES as readonly string[]).includes(value);
}

export interface AccountState {
  isTestUser: boolean;
  role: string | null;
  status: AccountStatus;
  expiresAt: string | null;
}

/**
 * Loads the account lifecycle state for a user. A missing profile row cannot
 * happen in practice (a signup trigger creates one); if the service/tests
 * return none it is treated as an unrestricted, active account so existing
 * behavior is never broken by an absent row.
 */
export async function loadAccountState(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<AccountState> {
  const { data, error } = await supabase
    .from("profiles")
    .select("role, status, is_test_user, expires_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw supabaseErrorToAppError(error);
  if (!data) {
    return { isTestUser: false, role: null, status: "active", expiresAt: null };
  }
  return {
    isTestUser: data.is_test_user,
    role: data.role,
    status: data.status,
    expiresAt: data.expires_at,
  };
}

/**
 * Pure account-lifecycle check used by every protected route: a pending,
 * rejected, disabled, or expired account is rejected regardless of any
 * granted capability. The super_admin owner is never blocked by lifecycle
 * state (its ownership is protected on every write path). Throws a
 * ForbiddenError with a user-safe message (no internal details leaked).
 */
export function assertAccountAccess(state: AccountState): void {
  if (state.role === SUPER_ADMIN_ROLE) return;
  const message = accountStatusMessage(state.status);
  if (message) throw new ForbiddenError(message);
  if (state.expiresAt && Date.parse(state.expiresAt) <= Date.now()) {
    throw new ForbiddenError(EXPIRED_ACCOUNT_MESSAGE);
  }
}

/**
 * Server-side capability gate for test users.
 *
 * Normal (non-test) accounts are unrestricted for backward compatibility.
 * Test users are allowed only the capabilities an admin actually granted;
 * anything else is denied here — the UI cannot bypass this check.
 *
 * Also enforces account lifecycle (disabled / expired) for every account.
 */
export async function requireCapability(
  supabase: SupabaseClient<Database>,
  userId: string,
  capability: Capability
): Promise<void> {
  const state = await loadAccountState(supabase, userId);
  assertAccountAccess(state);
  if (!state.isTestUser) return;

  const { data, error } = await supabase
    .from("app_permissions")
    .select("permission")
    .eq("user_id", userId)
    .eq("permission", capability)
    .maybeSingle();
  if (error) throw supabaseErrorToAppError(error);
  if (!data) {
    throw new ForbiddenError(
      `Access to ${CAPABILITY_LABELS[capability]} is not enabled for your account.`
    );
  }
}