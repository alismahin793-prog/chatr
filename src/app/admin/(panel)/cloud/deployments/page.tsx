import { requireAdminIdentity } from "@/server/admin/security";
import AdminSection from "@/components/admin/AdminSection";
import { CloudDeploymentsGlobal } from "@/components/admin/cloud/CloudProjectDeployments";

export default async function AdminCloudDeploymentsGlobalPage() {
  await requireAdminIdentity();
  return (
    <AdminSection
      titleKey="pages.cloud.deployments.title"
      descriptionKey="pages.cloud.deployments.description"
    >
      <CloudDeploymentsGlobal />
    </AdminSection>
  );
}