"use client";

import Link from "next/link";
import { useAdminI18n } from "@/i18n/LanguageProvider";
import type { TranslationKey } from "@/i18n/translations/en";
import type { CloudProjectTab } from "@/components/admin/cloud/CloudProjectShell";

const TABS: { id: CloudProjectTab; label: TranslationKey }[] = [
  { id: "overview", label: "cloud.projects.tabs.overview" },
  { id: "files", label: "cloud.projects.tabs.files" },
  { id: "terminal", label: "cloud.projects.tabs.terminal" },
  { id: "git", label: "cloud.projects.tabs.git" },
  { id: "pipeline", label: "cloud.projects.tabs.pipeline" },
  { id: "snapshots", label: "cloud.projects.tabs.snapshots" },
  { id: "deployments", label: "cloud.projects.tabs.deployments" },
  { id: "environments", label: "cloud.projects.tabs.environment" },
];

/** Translated tab bar for a cloud project shell page. */
export default function CloudProjectTabs({
  projectId,
  tab,
}: {
  projectId: string;
  tab: CloudProjectTab;
}) {
  const { t } = useAdminI18n();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
      {TABS.map((item) => (
        <Link
          key={item.id}
          href={`/admin/cloud/projects/${projectId}${item.id === "overview" ? "" : "/" + item.id}`}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === item.id
              ? "bg-indigo-600 text-white"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          {t(item.label)}
        </Link>
      ))}
    </div>
  );
}