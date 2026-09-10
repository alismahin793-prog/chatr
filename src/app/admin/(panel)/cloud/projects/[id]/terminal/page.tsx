import { requireAdminIdentity } from "@/server/admin/security";
import { createServiceClient } from "@/lib/supabase/service";
import { getProjectOrThrow, listOperations } from "@/server/cloud/service";
import CloudProjectShell from "@/components/admin/cloud/CloudProjectShell";
import CloudTerminal from "@/components/admin/cloud/CloudTerminal";

export default async function AdminCloudProjectTerminalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdminIdentity();
  const service = createServiceClient();
  const project = await getProjectOrThrow(service, id);
  const operations = await listOperations(service, project.id);
  return (
    <CloudProjectShell projectId={id} tab="terminal">
      <CloudTerminal projectId={id} initialOperations={operations} />
    </CloudProjectShell>
  );
}