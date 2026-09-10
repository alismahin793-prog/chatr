"use client";

import Link from "next/link";
import { useAdminI18n } from "@/i18n/LanguageProvider";

interface PipelineStepView {
  stepKey: string;
  args: string[];
  timeoutMs: number;
  description: string;
}

interface CloudHubOverviewProps {
  pipelineSteps: PipelineStepView[];
  stepChain: string;
  lastDeploymentAt: string;
}

export default function CloudHubOverview({
  pipelineSteps,
  stepChain,
  lastDeploymentAt,
}: CloudHubOverviewProps) {
  const { t, dir } = useAdminI18n();
  const arrow = dir === "rtl" ? "←" : "→";

  const cards = [
    {
      href: "/admin/cloud/projects",
      title: t("pages.cloud.hub.cardProjects"),
      description: t("pages.cloud.hub.cardProjectsDescription"),
    },
    {
      href: "/admin/cloud/deployments",
      title: t("pages.cloud.hub.cardDeployments"),
      description: t("pages.cloud.hub.cardDeploymentsDescription"),
    },
    {
      href: "/admin/cloud/environments",
      title: t("pages.cloud.hub.cardEnvironments"),
      description: t("pages.cloud.hub.cardEnvironmentsDescription"),
    },
    {
      href: "/admin/cloud/projects",
      title: t("pages.cloud.hub.cardPipeline"),
      description: t("pages.cloud.hub.cardPipelineDescription", { steps: stepChain }),
    },
  ];

  return (
    <>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {cards.map((card) => (
          <Link
            key={card.title}
            href={card.href}
            className="group block rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 group-hover:text-indigo-700">
                {card.title}
              </h3>
              <span className="text-slate-300 transition-colors group-hover:text-indigo-600">
                {arrow}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">{card.description}</p>
          </Link>
        ))}
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-slate-900">
          {t("pages.cloud.hub.pipelineSteps")}
        </h2>
        <div className="mt-3 space-y-2">
          {pipelineSteps.map((step) => (
            <div
              key={step.stepKey}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2.5"
            >
              <div>
                <code className="font-mono text-sm font-medium text-slate-800">
                  npm {step.args.join(" ")}
                </code>
                <p className="text-xs text-slate-500">{step.description}</p>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-slate-400">
                {Math.round(step.timeoutMs / 60000)} {t("pages.cloud.hub.minTimeout")}
              </span>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-8 text-xs text-slate-400">
        {t("pages.cloud.hub.lastDeploymentAt")} {lastDeploymentAt} ·{" "}
        <Link href="/admin/audit" className="text-indigo-600 hover:underline">
          {t("pages.cloud.hub.auditTrail")} {arrow}
        </Link>
      </p>
    </>
  );
}