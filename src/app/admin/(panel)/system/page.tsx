import { requireAdminIdentity } from "@/server/admin/security";
import { getSystemErrors, getSystemHealth } from "@/server/admin/system";
import AdminSection from "@/components/admin/AdminSection";
import SystemHealthCards from "@/components/admin/pages/SystemHealthCards";

/**
 * System page. Requires super_admin identity (enforced server-side). Renders
 * database health and the recent failed-actions list.
 */
export default async function AdminSystemPage() {
  const ctx = await requireAdminIdentity();
  const [health, errors] = await Promise.all([
    getSystemHealth(ctx.service),
    getSystemErrors(ctx.service),
  ]);

  return (
    <AdminSection
      titleKey="pages.system.title"
      descriptionKey="pages.system.description"
    >
      <SystemHealthCards
        status={health.status}
        database={health.database}
        userCount={health.stats.users}
        timestamp={health.timestamp}
        errors={errors}
      />
    </AdminSection>
  );
}
