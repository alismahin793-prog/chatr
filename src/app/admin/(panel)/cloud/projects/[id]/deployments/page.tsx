import { requireAdminIdentity } from "@/server/admin/security";
import CloudProjectShell from "@/components/admin/cloud/CloudProjectShell";
import CloudProjectDeployments from "@/components/admin/cloud/CloudProjectDeployments";

export default async function AdminCloudProjectDeploymentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdminIdentity();
  return (
    <CloudProjectShell projectId={id} tab="deployments">
      <CloudProjectDeployments projectId={id} />
    </CloudProjectShell>
  );
}