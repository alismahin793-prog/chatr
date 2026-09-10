import { notFound } from "next/navigation";
import { requireAdminIdentity } from "@/server/admin/security";
import { createServiceClient } from "@/lib/supabase/service";
import { SupabaseSelfDevelopmentStore } from "@/server/self-development/store";
import SelfDevelopmentDetail from "@/components/admin/cloud/selfdevelopment/SelfDevelopmentDetail";

export default async function AdminSelfDevelopmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminIdentity();
  const { id } = await params;
  const service = createServiceClient();
  const store = new SupabaseSelfDevelopmentStore(service);
  const view = await store.getRequest(id);
  if (!view) notFound();
  const [steps, changes] = await Promise.all([
    store.listSteps(id),
    store.listChanges(id),
  ]);
  return (
    <SelfDevelopmentDetail
      initial={{ request: view.request, project: view.project, steps, changes }}
    />
  );
}