import { requireAdminIdentity } from "@/server/admin/security";
import CloudProjectShell from "@/components/admin/cloud/CloudProjectShell";
import CloudGitPanel from "@/components/admin/cloud/CloudGitPanel";

export default async function AdminCloudProjectGitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdminIdentity();
  return (
    <CloudProjectShell projectId={id} tab="git">
      <CloudGitPanel projectId={id} />
    </CloudProjectShell>
  );
}