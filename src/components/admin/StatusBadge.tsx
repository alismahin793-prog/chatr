"use client";

import { useAdminI18n } from "@/i18n/LanguageProvider";

/**
 * Small shared chip for binary success states (used in activity tables and
 * audits). Pure presentational — no client hooks, safe in server components.
 */
export default function StatusBadge({ success, label }: { success: boolean; label?: string }) {
  const { t } = useAdminI18n();
  const text = label ?? (success ? t("status.succeeded") : t("status.failed"));
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
        success
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
          : "bg-red-50 text-red-700 ring-red-200"
      }`}
    >
      <span className={`size-1.5 rounded-full ${success ? "bg-emerald-500" : "bg-red-500"}`} />
      {text}
    </span>
  );
}