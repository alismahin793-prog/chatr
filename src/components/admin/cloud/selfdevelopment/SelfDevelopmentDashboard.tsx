"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminSection from "@/components/admin/AdminSection";
import { cloudApi, type SelfDevelopmentRequestView } from "@/components/admin/cloud/CloudApi";
import { useAdminI18n } from "@/i18n/LanguageProvider";
import { formatDate } from "@/components/admin/cloud/formatDate";
import {
  SelfDevelopmentRiskBadge,
  SelfDevelopmentStatusBadge,
} from "@/components/admin/cloud/selfdevelopment/SelfDevelopmentBadge";

function summarize(requests: SelfDevelopmentRequestView[]) {
  return {
    total: requests.length,
    awaitingPlan: requests.filter((v) => v.request.status === "awaiting_plan_approval").length,
    awaitingDeploy: requests.filter((v) => v.request.status === "awaiting_deploy_approval").length,
    completed: requests.filter((v) => v.request.status === "completed").length,
    failed: requests.filter((v) => v.request.status === "failed").length,
    rolledBack: requests.filter((v) => v.request.status === "rolled_back").length,
  };
}

export default function SelfDevelopmentDashboard({
  initial,
}: {
  initial: SelfDevelopmentRequestView[];
}) {
  const { t } = useAdminI18n();
  const [requests, setRequests] = useState<SelfDevelopmentRequestView[]>(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    cloudApi.selfDevelopment
      .list()
      .then(({ requests: list }) => {
        if (!cancelled) setRequests(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t("selfdev.dashboard.loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = summarize(requests);

  return (
    <AdminSection
      titleKey="nav.selfDevelopment"
      descriptionKey="selfdev.dashboard.description"
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex flex-wrap gap-2 text-xs">
          <Stat label={t("selfdev.stats.total")} value={counts.total} />
          <Stat label={t("selfdev.status.awaiting_plan_approval")} value={counts.awaitingPlan} />
          <Stat label={t("selfdev.status.awaiting_deploy_approval")} value={counts.awaitingDeploy} />
          <Stat label={t("selfdev.status.completed")} value={counts.completed} />
          <Stat label={t("status.failed")} value={counts.failed} />
          <Stat label={t("selfdev.status.rolled_back")} value={counts.rolledBack} />
        </div>
        <Link
          href="/admin/cloud/self-development/new"
          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
        >
          {t("selfdev.stats.newRequest")}
        </Link>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {requests.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="font-medium text-slate-700">{t("selfdev.dashboard.emptyTitle")}</p>
          <p className="mt-1 text-sm text-slate-500">
            {t("selfdev.dashboard.emptyBody")}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-start text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">{t("selfdev.table.request")}</th>
                <th className="px-4 py-3 font-medium">{t("selfdev.table.project")}</th>
                <th className="px-4 py-3 font-medium">{t("selfdev.table.risk")}</th>
                <th className="px-4 py-3 font-medium">{t("common.status")}</th>
                <th className="px-4 py-3 font-medium">{t("common.updated")}</th>
              </tr>
            </thead>
            <tbody>
              {requests.map(({ request, project }) => (
                <tr key={request.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/cloud/self-development/${request.id}`}
                      className="font-medium text-slate-800 hover:text-indigo-700"
                    >
                      {request.prompt.length > 90 ? `${request.prompt.slice(0, 90)}...` : request.prompt}
                    </Link>
                    <div className="mt-0.5 font-mono text-[11px] text-slate-400">{request.id.slice(0, 8)}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <Link href={`/admin/cloud/projects/${project.id}`} className="hover:text-indigo-700">
                      {project.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <SelfDevelopmentRiskBadge risk={request.risk_level} />
                  </td>
                  <td className="px-4 py-3">
                    <SelfDevelopmentStatusBadge status={request.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 tabular-nums">{formatDate(request.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-xs text-slate-400">
        {t("selfdev.dashboard.footer")}
      </p>
    </AdminSection>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1">
      <span className="font-medium tabular-nums text-slate-800">{value}</span>
      <span className="text-slate-500">{label}</span>
    </span>
  );
}