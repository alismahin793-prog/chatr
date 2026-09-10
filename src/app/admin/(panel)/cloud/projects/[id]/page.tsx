import { requireAdminIdentity } from "@/server/admin/security";
import CloudProjectShell from "@/components/admin/cloud/CloudProjectShell";
import CloudProjectOverview from "@/components/admin/cloud/CloudProjectOverview";

export default async function AdminCloudProjectOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdminIdentity();
  return (
    <CloudProjectShell projectId={id} tab="overview">
      <CloudProjectOverview projectId={id} />
    </CloudProjectShell>
  );
}