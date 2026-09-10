import { requireAdminIdentity } from "@/server/admin/security";
import { getAiUsageStats } from "@/server/ai/usage";
import AdminSection from "@/components/admin/AdminSection";
import AiUsageCards from "@/components/admin/pages/AiUsageCards";

/**
 * AI & Usage page. Requires super_admin identity. Renders request telemetry:
 * totals, per-provider / per-model counts, and a 7-day bar chart. No message
 * content or keys are ever shown.
 */
export default async function AdminAiUsagePage() {
  const ctx = await requireAdminIdentity();
  const usage = await getAiUsageStats(ctx.service);

  const providerRows = Object.entries(usage.byProvider).sort((a, b) => b[1] - a[1]);
  const modelRows = Object.entries(usage.byModel).sort((a, b) => b[1] - a[1]);

  return (
    <AdminSection
      titleKey="pages.ai.title"
      descriptionKey="pages.ai.description"
    >
      <AiUsageCards
        total={usage.total}
        today={usage.today}
        last7Days={usage.last7Days}
        byProvider={providerRows}
        byModel={modelRows}
      />
    </AdminSection>
  );
}
