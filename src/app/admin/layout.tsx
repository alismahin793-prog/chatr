import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireAdminIdentity } from "@/server/admin/security";
import { getGrantedPermissionGroups } from "@/server/admin/permissions";
import AdminSidebar from "@/components/admin/AdminSidebar";

/**
 * Admin Panel layout. This is a SERVER component: it enforces the admin role
 * before any admin page is rendered. Sensitive actions within individual
 * pages/routes additionally require a fresh 30-second re-auth window.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  let identity;
  try {
    identity = await requireAdminIdentity();
  } catch {
    redirect("/login");
  }

  const groups = await getGrantedPermissionGroups(identity.user.id);

  return (
    <div className="min-h-screen bg-zinc-50">
      <AdminSidebar
        groups={groups}
        adminName={identity.profile.display_name ?? identity.user.email ?? "Admin"}
      />
      <main className="p-6 md:ml-64 md:p-8">{children}</main>
    </div>
  );
}
