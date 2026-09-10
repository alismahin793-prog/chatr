import { requireAdminIdentity } from "@/server/admin/security";
import { createServiceClient } from "@/lib/supabase/service";
import { getAdminStats, getRecentActivity } from "@/server/admin/stats";
import { getAiUsageStats } from "@/server/ai/usage";
import { cloudStats } from "@/server/cloud/service";
import AdminSection from "@/components/admin/AdminSection";
import AdminDashboard from "@/components/admin/AdminDashboard";
import CloudHubStats from "@/components/admin/cloud/CloudHubStats";
import CloudConsoleLink from "@/components/admin/cloud/CloudConsoleLink";

/**
 * Admin landing page. Enforces the admin role server-side, then renders the
 * console dashboard fed by aggregate platform data (service role). Detail
 * sections live on their own pages (each behind the same server guard).
 */
export default async function AdminDashboardPage() {
  await requireAdminIdentity();
  const service = createServiceClient();
  const [stats, usage, recentActivity, cloud] = await Promise.all([
    getAdminStats(service),
    getAiUsageStats(service),
    getRecentActivity(service),
    cloudStats(service),
  ]);

  return (
    <AdminSection
      titleKey="dashboard.title"
      descriptionKey="dashboard.description"
    >
      <AdminDashboard stats={stats} usage={usage} activity={recentActivity} />
      <div className="mt-6">
        <CloudHubStats stats={cloud} />
        <CloudConsoleLink />
      </div>
    </AdminSection>
  );
}