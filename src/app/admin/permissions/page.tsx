import {
  requirePermission,
  PERMISSIONS,
  PERMISSION_GROUPS,
  SENSITIVE_PERMISSIONS,
  type PermissionGroupKey,
} from "@/server/admin/permissions";
import { PermissionManager } from "@/components/admin/PermissionManager";

/**
 * Permission management page. Requires the admin role AND the
 * manage_user_roles permission. The re-auth window is enforced server-side by
 * the POST/DELETE handlers (via requireSensitivePermission); this page only
 * needs to render, and the client re-auth modal restores the window before a
 * grant/revoke is submitted.
 */
export default async function AdminPermissionsPage() {
  const ctx = await requirePermission(PERMISSIONS.MANAGE_USER_ROLES);

  const [{ data: users }, { data: grants }] = await Promise.all([
    ctx.service.from("profiles").select("id, display_name"),
    ctx.service.from("admin_permissions").select("user_id, permission"),
  ]);

  const byUser = new Map<string, Set<string>>();
  for (const g of grants ?? []) {
    if (!byUser.has(g.user_id)) byUser.set(g.user_id, new Set());
    byUser.get(g.user_id)!.add(g.permission);
  }

  const { data: authUsers } = await ctx.service.auth.admin.listUsers();

  const emailById = new Map<string, string>();
  for (const au of authUsers?.users ?? []) {
    emailById.set(au.id, au.email ?? "");
  }

  const rows = (users ?? []).map((u) => ({
    id: u.id,
    name: u.display_name ?? "",
    email: emailById.get(u.id) ?? "",
    permissions: Array.from(byUser.get(u.id) ?? []).sort(),
  }));

  const groups = (Object.keys(PERMISSION_GROUPS) as PermissionGroupKey[]).map(
    (key) => ({
      key,
      label: PERMISSION_GROUPS[key].label,
      permissions: [...PERMISSION_GROUPS[key].permissions],
    })
  );

  return (
    <PermissionManager
      users={rows}
      groups={groups}
      sensitivePermissions={[...SENSITIVE_PERMISSIONS]}
    />
  );
}
