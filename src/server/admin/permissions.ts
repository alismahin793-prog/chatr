import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/service";
import { supabaseErrorToAppError } from "@/server/data/errors";
import { ForbiddenError } from "@/server/errors";
import {
  type AdminContext,
  type AdminIdentityContext,
  requireAdmin,
  requireAdminIdentity,
} from "@/server/admin/security";

// ------------------------------------------------------------------
// Permission constants
// ------------------------------------------------------------------

export const PERMISSIONS = {
  // USER_MANAGEMENT
  VIEW_USERS: "view_users",
  DISABLE_USERS: "disable_users",
  MANAGE_USER_ROLES: "manage_user_roles",
  VIEW_USER_ACTIVITY: "view_user_activity",
  // AI_PROVIDERS
  VIEW_PROVIDERS: "view_providers",
  VIEW_MODEL_CONFIG: "view_model_config",
  MANAGE_PROVIDER_AVAILABILITY: "manage_provider_availability",
  MANAGE_USAGE_LIMITS: "manage_usage_limits",
  // SYSTEM
  VIEW_SYSTEM_HEALTH: "view_system_health",
  VIEW_SYSTEM_ERRORS: "view_system_errors",
  VIEW_USAGE_STATS: "view_usage_stats",
  MANAGE_APP_SETTINGS: "manage_app_settings",
  // SECURITY
  VIEW_AUDIT_LOGS: "view_audit_logs",
  VIEW_ACTIVE_SESSIONS: "view_active_sessions",
  REVOKE_USER_SESSIONS: "revoke_user_sessions",
  VIEW_FAILED_AUTH: "view_failed_auth",
  // SELF_DEVELOPMENT
  CREATE_DEV_REQUESTS: "create_dev_requests",
  APPROVE_DEV_PLANS: "approve_dev_plans",
  APPROVE_DEPLOYMENTS: "approve_deployments",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

/**
 * Permissions that require a fresh 30-second admin re-authentication window
 * before they can be used. These are destructive or irreversible operations.
 */
export const SENSITIVE_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.DISABLE_USERS,
  PERMISSIONS.MANAGE_USER_ROLES,
  PERMISSIONS.MANAGE_PROVIDER_AVAILABILITY,
  PERMISSIONS.MANAGE_USAGE_LIMITS,
  PERMISSIONS.MANAGE_APP_SETTINGS,
  PERMISSIONS.REVOKE_USER_SESSIONS,
  PERMISSIONS.APPROVE_DEV_PLANS,
  PERMISSIONS.APPROVE_DEPLOYMENTS,
];

/** Permission groups for sidebar rendering. */
export const PERMISSION_GROUPS = {
  USER_MANAGEMENT: {
    label: "User Management",
    permissions: [
      PERMISSIONS.VIEW_USERS,
      PERMISSIONS.DISABLE_USERS,
      PERMISSIONS.MANAGE_USER_ROLES,
      PERMISSIONS.VIEW_USER_ACTIVITY,
    ],
  },
  AI_PROVIDERS: {
    label: "AI & Providers",
    permissions: [
      PERMISSIONS.VIEW_PROVIDERS,
      PERMISSIONS.VIEW_MODEL_CONFIG,
      PERMISSIONS.MANAGE_PROVIDER_AVAILABILITY,
      PERMISSIONS.MANAGE_USAGE_LIMITS,
    ],
  },
  SYSTEM: {
    label: "System",
    permissions: [
      PERMISSIONS.VIEW_SYSTEM_HEALTH,
      PERMISSIONS.VIEW_SYSTEM_ERRORS,
      PERMISSIONS.VIEW_USAGE_STATS,
      PERMISSIONS.MANAGE_APP_SETTINGS,
    ],
  },
  SECURITY: {
    label: "Security",
    permissions: [
      PERMISSIONS.VIEW_AUDIT_LOGS,
      PERMISSIONS.VIEW_ACTIVE_SESSIONS,
      PERMISSIONS.REVOKE_USER_SESSIONS,
      PERMISSIONS.VIEW_FAILED_AUTH,
    ],
  },
  SELF_DEVELOPMENT: {
    label: "Self-Development",
    permissions: [
      PERMISSIONS.CREATE_DEV_REQUESTS,
      PERMISSIONS.APPROVE_DEV_PLANS,
      PERMISSIONS.APPROVE_DEPLOYMENTS,
    ],
  },
} as const;

export type PermissionGroupKey = keyof typeof PERMISSION_GROUPS;

export interface GrantedGroup {
  key: PermissionGroupKey;
  label: string;
}

/**
 * Returns the permission groups for which the given admin holds at least one
 * permission. Used by the Admin Panel sidebar. Reads via the service client.
 */
export async function getGrantedPermissionGroups(
  userId: string
): Promise<GrantedGroup[]> {
  const service = createServiceClient();
  const perms = await getUserPermissions(service, userId);
  const groups = (Object.keys(PERMISSION_GROUPS) as PermissionGroupKey[])
    .filter((key) =>
      PERMISSION_GROUPS[key].permissions.some((p) => perms.includes(p as Permission))
    )
    .map((key) => ({ key, label: PERMISSION_GROUPS[key].label }));
  return groups;
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

export function isValidPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}

export function isSensitivePermission(permission: Permission): boolean {
  return (SENSITIVE_PERMISSIONS as readonly Permission[]).includes(permission);
}

/**
 * Reads all permissions granted to a user. Uses the user-scoped client
 * (subject to RLS: users can only read their own permissions) or the
 * service client when called from server code.
 */
export async function getUserPermissions(
  client: SupabaseClient<Database>,
  userId: string
): Promise<Permission[]> {
  const { data, error } = await client
    .from("admin_permissions")
    .select("permission")
    .eq("user_id", userId);
  if (error) throw supabaseErrorToAppError(error);
  return (data?.map((r) => r.permission as Permission) ?? []).filter(isValidPermission);
}

/**
 * Checks whether a user holds a specific permission.
 */
export async function hasPermission(
  client: SupabaseClient<Database>,
  userId: string,
  permission: Permission
): Promise<boolean> {
  const { data, error } = await client
    .from("admin_permissions")
    .select("permission")
    .eq("user_id", userId)
    .eq("permission", permission)
    .maybeSingle();
  if (error) throw supabaseErrorToAppError(error);
  return data !== null;
}

// ------------------------------------------------------------------
// Guards
// ------------------------------------------------------------------

/**
 * Server-side guard: verifies the caller is an admin (role check only, no
 * window required) AND holds the specified permission.
 */
export async function requirePermission<T extends Permission>(
  permission: T
): Promise<AdminIdentityContext & { permission: T }> {
  const ctx = await requireAdminIdentity();
  const permitted = await hasPermission(ctx.service, ctx.user.id, permission);
  if (!permitted) {
    throw new ForbiddenError(`Missing required permission: ${permission}`);
  }
  return { ...ctx, permission };
}

/**
 * Server-side guard for sensitive operations: verifies the caller is an
 * admin with an active 30-second re-authentication window AND holds the
 * specified permission.
 */
export async function requireSensitivePermission<T extends Permission>(
  permission: T
): Promise<AdminContext & { permission: T }> {
  const ctx = await requireAdmin();
  const permitted = await hasPermission(ctx.service, ctx.user.id, permission);
  if (!permitted) {
    throw new ForbiddenError(`Missing required permission: ${permission}`);
  }
  return { ...ctx, permission };
}

// ------------------------------------------------------------------
// Mutation helpers (service-role only)
// ------------------------------------------------------------------

/**
 * Grants a permission to a user. Idempotent: if the permission already
 * exists, the insert is silently ignored via INSERT ... ON CONFLICT DO NOTHING.
 */
export async function grantPermission(
  service: SupabaseClient<Database>,
  userId: string,
  permission: Permission,
  grantedBy?: string
): Promise<void> {
  if (!isValidPermission(permission)) {
    throw new ForbiddenError(`Invalid permission: ${permission}`);
  }
  const { error } = await service
    .from("admin_permissions")
    .upsert(
      {
        user_id: userId,
        permission,
        granted_by: grantedBy ?? null,
      },
      { onConflict: "user_id,permission", ignoreDuplicates: true }
    );
  if (error) throw supabaseErrorToAppError(error);
}

/**
 * Revokes a permission from a user. No-op if the permission was not granted.
 */
export async function revokePermission(
  service: SupabaseClient<Database>,
  userId: string,
  permission: Permission
): Promise<void> {
  const { error } = await service
    .from("admin_permissions")
    .delete()
    .eq("user_id", userId)
    .eq("permission", permission);
  if (error) throw supabaseErrorToAppError(error);
}
