import { requireAdminIdentity } from "@/server/admin/security";
import { createServiceClient } from "@/lib/supabase/service";
import { cloudStats } from "@/server/cloud/service";
import { getExecutionProvider } from "@/server/cloud/execution/providers";
import { getWorkspaceProvider } from "@/server/cloud/workspace/providers";
import { getGitProvider } from "@/server/cloud/git/providers";
import { getDeploymentProvider } from "@/server/cloud/deploy/providers";
import { CLOUD_PIPELINE_STEPS } from "@/server/cloud/types";
import AdminSection from "@/components/admin/AdminSection";
import ProviderStatusPanel from "@/components/admin/cloud/CloudProviderStatus";
import CloudHubStats from "@/components/admin/cloud/CloudHubStats";
import { formatDate } from "@/components/admin/cloud/formatDate";
import CloudHubOverview from "@/components/admin/cloud/pages/CloudHubOverview";

/**
 * Cloud Development hub. Renders the REAL provider statuses (no fabrication:
 * on Vercel serverless the execution/provider assets may honestly report "not
 * configured") plus aggregate cloud stats.
 */
export default async function AdminCloudHubPage() {
  await requireAdminIdentity();
  const service = createServiceClient();
  const stats = await cloudStats(service);

  const providers = {
    execution: getExecutionProvider().status(),
    workspace: getWorkspaceProvider().status(),
    git: getGitProvider().providerStatus(),
    deployment: getDeploymentProvider().status(),
  };

  const pipelineSteps = CLOUD_PIPELINE_STEPS.map((step) => ({
    stepKey: step.key,
    args: step.args,
    timeoutMs: step.timeoutMs,
    description: step.description,
  }));

  return (
    <div className="space-y-6">
      <AdminSection
        titleKey="pages.cloud.hub.title"
        descriptionKey="pages.cloud.hub.description"
      >
        <ProviderStatusPanel providers={providers} />

        <CloudHubStats stats={stats} />

        <CloudHubOverview
          pipelineSteps={pipelineSteps}
          stepChain={CLOUD_PIPELINE_STEPS.map((s) => s.key).join(" → ")}
          lastDeploymentAt={formatDate(stats.lastDeploymentAt)}
        />
      </AdminSection>
    </div>
  );
}