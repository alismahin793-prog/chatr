import { requireAdminIdentity } from "@/server/admin/security";
import CloudProjectsManager from "@/components/admin/cloud/CloudProjectsManager";

export default async function AdminCloudProjectsPage() {
  await requireAdminIdentity();
  return <CloudProjectsManager />;
}