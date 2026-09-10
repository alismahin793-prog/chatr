import { requireAdminIdentity } from "@/server/admin/security";
import { getAiSettings } from "@/server/config/env";
import {
  listAvailableProviders,
  fallbackProviderIds,
} from "@/server/ai/factory";
import { getAiUsageStats } from "@/server/ai/usage";
import AdminSection from "@/components/admin/AdminSection";
import ProvidersGrid from "@/components/admin/pages/ProvidersGrid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * AI / Providers page. Requires super_admin identity (enforced server-side).
 * Shows which providers are configured (boolean only — never the keys), the
 * active selection and fallback order, plus per-provider request counts.
 */
export default async function AdminProvidersPage() {
  const ctx = await requireAdminIdentity();
  const settings = getAiSettings();
  const providers = listAvailableProviders();
  const fallbackChain =
    settings.provider === "mock" ? [] : fallbackProviderIds(settings.provider);
  const usage = await getAiUsageStats(ctx.service);

  return (
    <AdminSection
      titleKey="pages.providers.title"
      descriptionKey="pages.providers.description"
    >
      <ProvidersGrid
        providers={providers}
        activeProviderId={settings.provider}
        activeModel={settings.model}
        providerUsage={usage.byProvider}
        fallbackChain={fallbackChain}
      />
    </AdminSection>
  );
}
