import { requireAdminIdentity } from "@/server/admin/security";
import CloudProjectShell from "@/components/admin/cloud/CloudProjectShell";
import CloudPipelinePanel from "@/components/admin/cloud/CloudPipelinePanel";

export default async function AdminCloudProjectPipelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdminIdentity();
  return (
    <CloudProjectShell projectId={id} tab="pipeline">
      <CloudPipelinePanel projectId={id} />
    </CloudProjectShell>
  );
}