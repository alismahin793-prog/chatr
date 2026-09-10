"use client";

import Link from "next/link";
import { useAdminI18n } from "@/i18n/LanguageProvider";

export interface CloudStatsView {
  projects: number;
  activeProjects: number;
  runningOperations: number;
  lastBuild: "passed" | "failed" | "never";
  deployments: number;
  readyDeployments: number;
  activePreviews: number;
  snapshots: number;
}

/** Aggregate Cloud Development counters (server-fed, presentational). */
export default function CloudHubStats({ stats }: { stats: CloudStatsView }) {
  const { t } = useAdminI18n();
  const cells: { label: string; value: string | number; href?: string; accent?: boolean }[] = [
    { label: t("cloud.hub.projects"), value: stats.projects, href: "/admin/cloud/projects" },
    { label: t("cloud.hub.active"), value: stats.activeProjects },
    { label: t("cloud.hub.runningOperations"), value: stats.runningOperations, accent: stats.runningOperations > 0 },
    {
      label: t("cloud.hub.lastBuild"),
      value: stats.lastBuild === "passed" ? t("cloud.hub.lastBuildPassed") : stats.lastBuild === "failed" ? t("cloud.hub.lastBuildFailed") : t("cloud.hub.lastBuildNever"),
    },
    { label: t("cloud.hub.deployments"), value: stats.deployments, href: "/admin/cloud/deployments" },
    { label: t("cloud.hub.ready"), value: stats.readyDeployments },
    { label: t("cloud.hub.previews"), value: stats.activePreviews },
    { label: t("cloud.hub.snapshots"), value: stats.snapshots },
  ];

  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900">{t("cloud.hub.summary")}</h2>
      </div>
      <dl className="grid grid-cols-2 gap-px bg-slate-200 sm:grid-cols-4">
        {cells.map((cell) => (
          <div key={cell.label} className="bg-white px-4 py-4">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{cell.label}</dt>
            <dd
              className={`mt-1 text-xl font-semibold tabular-nums ${
                cell.accent ? "animate-pulse text-indigo-600" : "text-slate-900"
              }`}
            >
              {cell.href ? <Link href={cell.href}>{cell.value}</Link> : cell.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}