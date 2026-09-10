import { requireAdminIdentity } from "@/server/admin/security";
import { createServiceClient } from "@/lib/supabase/service";
import { SupabaseSelfDevelopmentStore } from "@/server/self-development/store";
import SelfDevelopmentDashboard from "@/components/admin/cloud/selfdevelopment/SelfDevelopmentDashboard";

export default async function AdminSelfDevelopmentPage() {
  await requireAdminIdentity();
  const service = createServiceClient();
  const store = new SupabaseSelfDevelopmentStore(service);
  const views = await store.listRequests();
  return <SelfDevelopmentDashboard initial={views} />;
}