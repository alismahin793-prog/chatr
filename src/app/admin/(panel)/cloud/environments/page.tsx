import { requireAdminIdentity } from "@/server/admin/security";
import { createServiceClient } from "@/lib/supabase/service";
import { listProjects } from "@/server/cloud/service";
import AdminSection from "@/components/admin/AdminSection";
import { formatDate } from "@/components/admin/cloud/formatDate";
import EnvironmentsGlobal from "@/components/admin/cloud/pages/EnvironmentsGlobal";

export default async function AdminCloudEnvironmentsGlobalPage() {
  await requireAdminIdentity();
  const service = createServiceClient();
  const projects = await listProjects(service);

  const rows = projects.map((project) => ({
    id: project.id,
    name: project.name,
    slug: project.slug,
    envVarCount: project.env_vars?.length ?? 0,
    updatedAt: formatDate(project.updated_at),
  }));

  return (
    <AdminSection
      titleKey="pages.cloud.environments.title"
      descriptionKey="pages.cloud.environments.description"
    >
      <EnvironmentsGlobal projects={rows} />
    </AdminSection>
  );
}