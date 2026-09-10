import { requireAdminIdentity } from "@/server/admin/security";
import TestUsersManager from "@/components/admin/TestUsersManager";

/**
 * Test-user management page. Requires super_admin identity (enforced by the
 * layout). All mutations (create, disable, enable, delete, reset password,
 * capabilities) are gated server-side by requireAdmin(), which additionally
 * enforces the 30-second re-authentication window.
 */
export default async function AdminTestUsersPage() {
  await requireAdminIdentity();
  return <TestUsersManager />;
}