import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import {
  adminGuardRedirectPath,
  requireAdminIdentity,
} from "@/server/admin/security";
import AdminLayout from "@/components/admin/AdminLayout";

/**
 * Admin Panel layout. This is a SERVER component: it enforces the super_admin
 * role before any admin page is rendered. Not signed in → /login; signed in
 * but not super_admin → /admin/denied (Access Denied). Sensitive actions
 * within individual pages/routes additionally require a fresh 30-second
 * re-authentication window via requireAdmin().
 */
export default async function AdminPanelLayout({ children }: { children: ReactNode }) {
  let identity;
  try {
    identity = await requireAdminIdentity();
  } catch (error) {
    redirect(adminGuardRedirectPath(error));
  }

  return (
    <AdminLayout
      adminName={identity.profile.display_name ?? identity.user.email ?? "Admin"}
      adminEmail={identity.user.email ?? ""}
    >
      {children}
    </AdminLayout>
  );
}