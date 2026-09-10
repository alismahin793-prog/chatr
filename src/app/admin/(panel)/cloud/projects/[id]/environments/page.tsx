import { requireAdminIdentity } from "@/server/admin/security";
import CloudProjectShell from "@/components/admin/cloud/CloudProjectShell";
import CloudEnvPanel from "@/components/admin/cloud/CloudEnvPanel";

export default async function AdminCloudProjectEnvironmentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdminIdentity();
  return (
    <CloudProjectShell projectId={id} tab="environments">
      <CloudEnvPanel projectId={id} />
    </CloudProjectShell>
  );
}