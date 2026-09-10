import { requireAdminIdentity } from "@/server/admin/security";
import CloudProjectShell from "@/components/admin/cloud/CloudProjectShell";
import CloudFileExplorer from "@/components/admin/cloud/CloudFileExplorer";

export default async function AdminCloudProjectFilesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdminIdentity();
  return (
    <CloudProjectShell projectId={id} tab="files">
      <CloudFileExplorer projectId={id} />
    </CloudProjectShell>
  );
}