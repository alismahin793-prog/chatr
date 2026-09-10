"use client";

import Link from "next/link";
import type { AdminStats, RecentActivityEntry } from "@/server/admin/stats";
import type { AiUsageStats } from "@/server/ai/usage";
import AdminIcon from "@/components/admin/AdminIcons";
import type { AdminIconName } from "@/components/admin/nav";
import StatusBadge from "@/components/admin/StatusBadge";
import { useAdminI18n } from "@/i18n/LanguageProvider";

interface AdminDashboardProps {
  stats: AdminStats;
  usage: AiUsageStats;
  activity: RecentActivityEntry[];
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500",
  approved: "bg-emerald-500",
  rejected: "bg-red-500",
  disabled: "bg-slate-400",
};

/**
 * Landing view of the Admin Console. Purely presentational: the page it lives
 * on fetches the aggregate data through the service role and passes it down.
 */
export default function AdminDashboard({ stats, usage, activity }: AdminDashboardProps) {
  const { t } = useAdminI18n();
  const kpis: { label: string; value: string | number; icon: AdminIconName; href: string; accent: string }[] = [
    {
      label: t("dashboard.totalUsers"),
      value: stats.users,
      icon: "users",
      href: "/admin/users",
      accent: "text-slate-900",
    },
    {
      label: t("dashboard.pendingApproval"),
      value: stats.usersPending,
      icon: "inbox",
      href: "/admin/requests",
      accent: "text-amber-600",
    },
    {
      label: t("dashboard.approved"),
      value: stats.usersApproved,
      icon: "shield",
      href: "/admin/users",
      accent: "text-emerald-600",
    },
    {
      label: t("dashboard.disabled"),
      value: stats.usersDisabled,
      icon: "users",
      href: "/admin/users",
      accent: "text-slate-500",
    },
    {
      label: t("dashboard.aiRequests"),
      value: stats.aiRequests,
      icon: "chart",
      href: "/admin/ai",
      accent: "text-indigo-600",
    },
    {
      label: t("dashboard.aiRequestsToday"),
      value: stats.aiRequestsToday,
      icon: "activity",
      href: "/admin/ai",
      accent: "text-indigo-600",
    },
    {
      label: t("dashboard.featuresEnabled"),
      value: `${stats.featuresEnabled}/${stats.featuresTotal}`,
      icon: "toggle",
      href: "/admin/features",
      accent: "text-slate-900",
    },
    {
      label: t("dashboard.openProposals"),
      value: stats.proposalsOpen,
      icon: "bulb",
      href: "/admin/improvements",
      accent: "text-slate-900",
    },
  ];

  const maxDaily = Math.max(1, ...usage.last7Days.map((day) => day.count));
  const statusRows = [
    { label: t("dashboard.pending"), value: stats.usersPending, color: STATUS_COLORS.pending },
    { label: t("dashboard.approved"), value: stats.usersApproved, color: STATUS_COLORS.approved },
    { label: t("dashboard.rejected"), value: stats.usersRejected, color: STATUS_COLORS.rejected },
    { label: t("dashboard.disabled"), value: stats.usersDisabled, color: STATUS_COLORS.disabled },
  ];
  const statusTotal = Math.max(1, statusRows.reduce((sum, row) => sum + row.value, 0));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <Link
            key={kpi.label}
            href={kpi.href}
            className="group rounded-xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-md"
          >
            <div className="flex items-start justify-between">
              <p className="text-sm font-medium text-slate-500">{kpi.label}</p>
              <span className="text-slate-300 transition-colors group-hover:text-indigo-500">
                <AdminIcon name={kpi.icon} className="size-4" />
              </span>
            </div>
            <p className={`mt-2 text-2xl font-semibold tabular-nums tracking-tight ${kpi.accent}`}>
              {kpi.value}
            </p>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="rounded-xl border border-slate-200 bg-white lg:col-span-3">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">{t("dashboard.aiRequests")}</h2>
              <p className="text-xs text-slate-500">{t("dashboard.last7Days")}</p>
            </div>
            <span className="text-xs tabular-nums text-slate-500">
              {usage.total} {t("dashboard.total")} · {usage.today} {t("dashboard.today")}
            </span>
          </div>
          <div className="flex h-48 items-end gap-2 px-5 pb-5 pt-4">
            {usage.last7Days.map((day) => (
              <div key={day.date} className="flex flex-1 flex-col items-center gap-1.5">
                <span className="text-[11px] tabular-nums text-slate-500">
                  {day.count > 0 ? day.count : ""}
                </span>
                <div
                  className="w-full rounded-t-md bg-gradient-to-t from-indigo-600 to-indigo-400 transition-opacity"
                  style={{ height: `${Math.max(6, (day.count / maxDaily) * 100)}%` }}
                  title={`${day.date}: ${day.count}`}
                />
                <span className="text-[10px] uppercase text-slate-400">
                  {new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, {
                    weekday: "short",
                  })}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white lg:col-span-2">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">{t("dashboard.accountsByStatus")}</h2>
            <p className="text-xs text-slate-500">{t("dashboard.lifecycleDistribution")}</p>
          </div>
          <div className="space-y-4 px-5 py-4">
            {statusRows.map((row) => (
              <div key={row.label}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-slate-600">{row.label}</span>
                  <span className="tabular-nums font-medium text-slate-900">{row.value}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${row.color}`}
                    style={{ width: `${(row.value / statusTotal) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            <Link
              href="/admin/requests"
              className="mt-2 block rounded-lg border border-slate-200 px-3 py-2 text-center text-sm font-medium text-slate-700 transition-colors hover:border-indigo-300 hover:text-indigo-600"
            >
              {t("dashboard.reviewRequests")}
            </Link>
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{t("dashboard.recentActivity")}</h2>
            <p className="text-xs text-slate-500">{t("dashboard.activitySubtitle")}</p>
          </div>
          <Link
            href="/admin/audit"
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            {t("dashboard.viewAuditLog")} →
          </Link>
        </div>
        {activity.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-400">{t("dashboard.noRecentActivity")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">{t("dashboard.activityAction")}</th>
                  <th className="px-3 py-3 font-medium">{t("dashboard.activityStatus")}</th>
                  <th className="px-3 py-3 font-medium">{t("dashboard.activityResource")}</th>
                  <th className="px-3 py-3 font-medium">{t("dashboard.activityWhen")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activity.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
                        {entry.action}
                      </code>
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge success={entry.success} />
                    </td>
                    <td className="px-3 py-3 text-slate-500">
                      {entry.resourceType ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-400">
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}