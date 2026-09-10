import { requireAdminIdentity } from "@/server/admin/security";
import { createServiceClient } from "@/lib/supabase/service";
import { listAccountsByStatus } from "@/server/admin/userApproval";
import AdminSection from "@/components/admin/AdminSection";
import ApprovalsManager from "@/components/admin/ApprovalsManager";

/**
 * Registration-approval screen. Owns the approval workflow for interactive
 * accounts (pending -> approved/rejected, and re-enabling rejected/disabled
 * accounts). This read is guarded by requireAdminIdentity (super_admin);
 * mutating actions go through the approval API which enforces a fresh 30s
 * re-authentication window.
 */
export default async function AdminRequestsPage() {
  await requireAdminIdentity();
  const service = createServiceClient();
  const pending = await listAccountsByStatus(service, ["pending"]);

  return (
    <AdminSection
      titleKey="pages.requests.title"
      descriptionKey="pages.requests.description"
    >
      <ApprovalsManager initialPending={pending} />
    </AdminSection>
  );
}
