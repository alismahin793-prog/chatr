import { requireAdminIdentity } from "@/server/admin/security";
import { createServiceClient } from "@/lib/supabase/service";
import { listProjects } from "@/server/cloud/service";
import SelfDevelopmentNewRequest from "@/components/admin/cloud/selfdevelopment/SelfDevelopmentNewRequest";

export default async function AdminSelfDevelopmentNewPage() {
  await requireAdminIdentity();
  const service = createServiceClient();
  const projects = await listProjects(service);
  return <SelfDevelopmentNewRequest projects={projects} />;
}