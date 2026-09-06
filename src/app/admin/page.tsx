import {
  getUserPermissions,
  PERMISSION_GROUPS,
  type PermissionGroupKey,
} from "@/server/admin/permissions";
import { requireAdminIdentity } from "@/server/admin/security";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Admin dashboard. Enforces the admin role. Shows only the sections the
 * admin holds at least one permission for.
 */
export default async function AdminDashboard() {
  const identity = await requireAdminIdentity();
  const service = createServiceClient();
  const perms = await getUserPermissions(service, identity.user.id);
  const permSet = new Set(perms);

  const grantedGroups = (Object.keys(PERMISSION_GROUPS) as PermissionGroupKey[])
    .filter((key) =>
      PERMISSION_GROUPS[key].permissions.some((p) => permSet.has(p))
    )
    .map((key) => ({
      key,
      label: PERMISSION_GROUPS[key].label,
      granted: PERMISSION_GROUPS[key].permissions.filter((p) => permSet.has(p))
        .length,
      total: PERMISSION_GROUPS[key].permissions.length,
    }));

  const totalGranted = permSet.size;

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-zinc-900">Dashboard</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Welcome back. You have {totalGranted} permission
        {totalGranted === 1 ? "" : "s"} granted across{" "}
        {grantedGroups.length} section{grantedGroups.length === 1 ? "" : "s"}.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {grantedGroups.length === 0 ? (
          <p className="col-span-full rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-sm text-zinc-500">
            You have not been granted any admin sections yet. An administrator
            will need to grant you permissions.
          </p>
        ) : (
          grantedGroups.map((group) => (
            <div
              key={group.key}
              className="rounded-xl border border-zinc-200 bg-white p-5"
            >
              <h2 className="font-semibold text-zinc-900">{group.label}</h2>
              <p className="mt-1 text-sm text-zinc-500">
                {group.granted} of {group.total} permissions
              </p>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full rounded-full bg-indigo-600"
                  style={{ width: `${(group.granted / group.total) * 100}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
