"use client";

import type { SelfDevelopmentRequestStatusLabel } from "@/components/admin/cloud/CloudApi";
import { useAdminI18n } from "@/i18n/LanguageProvider";
import type { TranslationKey } from "@/i18n/translations/en";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 ring-slate-200",
  planning: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  awaiting_plan_approval: "bg-amber-100 text-amber-800 ring-amber-200",
  snapshotting: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  workspace_preparing: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  analyzing: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  modifying: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  testing: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  typechecking: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  linting: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  building: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  reviewing: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  awaiting_deploy_approval: "bg-amber-100 text-amber-800 ring-amber-200",
  deploying: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  verifying: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  completed: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  failed: "bg-red-100 text-red-700 ring-red-200",
  rolled_back: "bg-rose-100 text-rose-700 ring-rose-200",
  cancelled: "bg-slate-100 text-slate-500 ring-slate-200",
  rejected: "bg-red-100 text-red-700 ring-red-200",
};

const STATUS_LABELS: Record<string, TranslationKey> = {
  draft: "selfdev.status.draft",
  planning: "selfdev.status.planning",
  awaiting_plan_approval: "selfdev.status.awaiting_plan_approval",
  snapshotting: "selfdev.status.snapshotting",
  workspace_preparing: "selfdev.status.workspace_preparing",
  analyzing: "selfdev.status.analyzing",
  modifying: "selfdev.status.modifying",
  testing: "selfdev.status.testing",
  typechecking: "selfdev.status.typechecking",
  linting: "selfdev.status.linting",
  building: "selfdev.status.building",
  reviewing: "selfdev.status.reviewing",
  awaiting_deploy_approval: "selfdev.status.awaiting_deploy_approval",
  deploying: "selfdev.status.deploying",
  verifying: "selfdev.status.verifying",
  completed: "selfdev.status.completed",
  failed: "selfdev.status.failed",
  rolled_back: "selfdev.status.rolled_back",
  cancelled: "selfdev.status.cancelled",
  rejected: "selfdev.status.rejected",
};

const RUNNING = new Set([
  "planning",
  "snapshotting",
  "workspace_preparing",
  "analyzing",
  "modifying",
  "testing",
  "typechecking",
  "linting",
  "building",
  "reviewing",
  "deploying",
  "verifying",
]);

export function SelfDevelopmentStatusBadge({
  status,
  size = "sm",
}: {
  status: SelfDevelopmentRequestStatusLabel;
  size?: "sm" | "md";
}) {
  const { t } = useAdminI18n();
  const color = STATUS_COLORS[status] ?? "bg-slate-100 text-slate-600 ring-slate-200";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium ring-1 ${
        size === "sm" ? "text-[11px]" : "text-xs"
      } ${color}`}
    >
      <span
        className={
          RUNNING.has(status)
            ? "inline-block size-1.5 animate-pulse rounded-full bg-current"
            : "inline-block size-1.5 rounded-full bg-current"
        }
      />
      {STATUS_LABELS[status] ? t(STATUS_LABELS[status]) : status.replace(/_/g, " ")}
    </span>
  );
}

const RISK_COLORS: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  medium: "bg-amber-100 text-amber-800 ring-amber-200",
  high: "bg-orange-100 text-orange-700 ring-orange-200",
  critical: "bg-rose-100 text-rose-700 ring-rose-200",
};

const RISK_LABELS: Record<string, TranslationKey> = {
  low: "selfdev.risk.low",
  medium: "selfdev.risk.medium",
  high: "selfdev.risk.high",
  critical: "selfdev.risk.critical",
};

export function SelfDevelopmentRiskBadge({ risk }: { risk: "low" | "medium" | "high" | "critical" }) {
  const { t } = useAdminI18n();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ring-1 ${
        RISK_COLORS[risk] ?? "bg-slate-100 text-slate-600 ring-slate-200"
      }`}
    >
      {RISK_LABELS[risk] ? t(RISK_LABELS[risk]) : risk}
    </span>
  );
}

const STEP_STATUS_COLORS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-500 ring-slate-200",
  running: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  passed: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  failed: "bg-red-100 text-red-700 ring-red-200",
  cancelled: "bg-amber-100 text-amber-700 ring-amber-200",
};

const STEP_STATUS_LABELS: Record<string, TranslationKey> = {
  pending: "selfdev.stepStatus.pending",
  running: "selfdev.stepStatus.running",
  passed: "selfdev.stepStatus.passed",
  failed: "selfdev.stepStatus.failed",
  cancelled: "selfdev.stepStatus.cancelled",
};

export function SelfDevelopmentStepBadge({ status }: { status: string }) {
  const { t } = useAdminI18n();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${
        STEP_STATUS_COLORS[status] ?? "bg-slate-100 text-slate-600 ring-slate-200"
      }`}
    >
      <span
        className={
          status === "running"
            ? "inline-block size-1.5 animate-pulse rounded-full bg-current"
            : "inline-block size-1.5 rounded-full bg-current"
        }
      />
      {STEP_STATUS_LABELS[status] ? t(STEP_STATUS_LABELS[status]) : status}
    </span>
  );
}