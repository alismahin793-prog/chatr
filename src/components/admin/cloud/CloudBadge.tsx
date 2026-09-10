"use client";

import { useAdminI18n } from "@/i18n/LanguageProvider";
import type { TranslationKey } from "@/i18n/translations/en";

interface CloudBadgeProps {
  status?: string | null;
  size?: "sm" | "md";
}

const COLORS: Record<string, string> = {
  ready: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  completed: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  passed: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  active: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  building: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  queued: "bg-slate-100 text-slate-600 ring-slate-200",
  running: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  failed: "bg-red-100 text-red-700 ring-red-200",
  cancelled: "bg-amber-100 text-amber-700 ring-amber-200",
  canceling: "bg-amber-100 text-amber-700 ring-amber-200",
  timed_out: "bg-orange-100 text-orange-700 ring-orange-200",
  rolled_back: "bg-rose-100 text-rose-700 ring-rose-200",
  expired: "bg-slate-100 text-slate-500 ring-slate-200",
  restoring: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  restored: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  never: "bg-slate-100 text-slate-500 ring-slate-200",
  archived: "bg-slate-100 text-slate-500 ring-slate-200",
  error: "bg-red-100 text-red-700 ring-red-200",
};

const STATUS_LABEL: Record<string, TranslationKey> = {
  ready: "cloud.status.ready",
  completed: "cloud.status.completed",
  passed: "cloud.status.passed",
  active: "cloud.status.active",
  building: "cloud.status.building",
  queued: "cloud.status.queued",
  running: "cloud.status.running",
  failed: "status.failed",
  cancelled: "cloud.status.cancelled",
  canceling: "cloud.status.canceling",
  timed_out: "cloud.status.timedOut",
  rolled_back: "cloud.status.rolledBack",
  expired: "cloud.status.expired",
  restoring: "cloud.status.restoring",
  restored: "cloud.status.restored",
  never: "common.never",
  archived: "cloud.status.archived",
  error: "common.error",
  preview: "cloud.status.preview",
};

/** Small status pill shared across Cloud Development panels. */
export default function CloudBadge({ status, size = "sm" }: CloudBadgeProps) {
  const { t } = useAdminI18n();
  const safeStatus = typeof status === "string" ? status : "";
  const color = COLORS[safeStatus] ?? "bg-slate-100 text-slate-600 ring-slate-200";
  const labelKey = STATUS_LABEL[safeStatus];
  const label = labelKey ? t(labelKey) : safeStatus.replace(/_/g, " ");
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ring-1 ${
        size === "sm" ? "text-[11px]" : "text-xs"
      } ${color}`}
    >
      <span
        className={
          safeStatus === "running" || safeStatus === "building"
            ? "inline-block size-1.5 animate-pulse rounded-full bg-current"
            : "inline-block size-1.5 rounded-full bg-current"
        }
      />
      {label}
    </span>
  );
}

/** Provider status row: consistent honest rendering of configured/unconfigured. */
export function ProviderRow({
  label,
  configured,
  reason,
}: {
  label: string;
  configured: boolean;
  reason?: string;
}) {
  const { t } = useAdminI18n();
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800">{label}</p>
        {reason ? <p className="mt-0.5 text-xs text-slate-500">{reason}</p> : null}
      </div>
      {configured ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          {t("common.configured")}
        </span>
      ) : (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
          <span className="size-1.5 rounded-full bg-amber-500" />
          {t("common.notConfigured")}
        </span>
      )}
    </div>
  );
}