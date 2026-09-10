"use client";

import type { ExecutionProviderStatus, DeploymentProviderStatus } from "@/server/cloud/types";
import { ProviderRow } from "@/components/admin/cloud/CloudBadge";
import { useAdminI18n } from "@/i18n/LanguageProvider";

interface CloudProviderStatusProps {
  providers: {
    execution: ExecutionProviderStatus;
    workspace: ExecutionProviderStatus;
    git: ExecutionProviderStatus;
    deployment: DeploymentProviderStatus;
  };
}

function hintFor(status: { reason?: string; description?: string }): string | undefined {
  return "reason" in status && status.reason ? status.reason : status.description;
}

/**
 * Honest runtime capability report. Providers that are not configured in the
 * current runtime are shown as such instead of pretending to work.
 */
export default function CloudProviderStatus({ providers }: CloudProviderStatusProps) {
  const { t } = useAdminI18n();
  const rows: { key: string; label: string; configured: boolean; hint?: string }[] = [
    {
      key: "execution",
      label: providers.execution.label,
      configured: providers.execution.configured,
      hint: hintFor(providers.execution),
    },
    { key: "workspace", label: providers.workspace.label, configured: providers.workspace.configured, hint: hintFor(providers.workspace) },
    { key: "git", label: providers.git.label, configured: providers.git.configured, hint: hintFor(providers.git) },
    { key: "deployment", label: providers.deployment.label, configured: providers.deployment.configured, hint: hintFor(providers.deployment) },
  ];

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900">{t("cloud.hub.runtimeCapabilities")}</h2>
        <p className="text-xs text-slate-500">
          {t("cloud.hub.runtimeCapabilitiesDescription")}
        </p>
      </div>
      <div className="divide-y divide-slate-100 px-5">
        {rows.map((row) => (
          <ProviderRow key={row.key} label={row.label} configured={row.configured} reason={row.hint} />
        ))}
      </div>
    </section>
  );
}