import { requireAdminIdentity } from "@/server/admin/security";
import CloudProjectShell from "@/components/admin/cloud/CloudProjectShell";
import CloudSnapshotsPanel from "@/components/admin/cloud/CloudSnapshotsPanel";

export default async function AdminCloudProjectSnapshotsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdminIdentity();
  return (
    <CloudProjectShell projectId={id} tab="snapshots">
      <CloudSnapshotsPanel projectId={id} />
    </CloudProjectShell>
  );
}