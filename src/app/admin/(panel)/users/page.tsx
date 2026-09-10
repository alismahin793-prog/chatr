import { requireAdminIdentity } from "@/server/admin/security";
import { createServiceClient } from "@/lib/supabase/service";
import { listAllAccounts } from "@/server/admin/accounts";
import AdminSection from "@/components/admin/AdminSection";
import UsersDirectoryTable from "@/components/admin/pages/UsersDirectoryTable";

/**
 * Users directory. Requires super_admin identity (enforced server-side).
 * Every account on the platform with its role (user / super_admin only) and
 * lifecycle status. Read-only; lifecycle changes happen on Registration
 * Requests; test-user lifecycle lives on Test Users.
 */
export default async function AdminUsersPage() {
  await requireAdminIdentity();
  const service = createServiceClient();
  const accounts = await listAllAccounts(service);

  return (
    <AdminSection
      titleKey="pages.users.title"
      descriptionKey="pages.users.description"
    >
      <UsersDirectoryTable accounts={accounts} />
    </AdminSection>
  );
}
