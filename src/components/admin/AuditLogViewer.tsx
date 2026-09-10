"use client";

import { useEffect, useState } from "react";
import AdminSection from "@/components/admin/AdminSection";
import { useAdminI18n } from "@/i18n/LanguageProvider";

export interface AuditEntry {
  id: string;
  actor_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  success: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
}

/**
 * Audit log viewer. Read-only table of admin actions, newest first. Metadata
 * was redacted at write time; this view never reveals secrets.
 */
export default function AuditLogViewer() {
  const { t } = useAdminI18n();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/audit", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(t("platform.audit.loadFailed"));
        const body = (await res.json()) as { entries: AuditEntry[] };
        if (!cancelled) {
          setEntries(body.entries);
          setLoading(false);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError(t("platform.audit.loadFailed"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <div className="max-w-6xl">
      <AdminSection
        title={t("platform.audit.title")}
        description={t("platform.audit.description")}
      />

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200"
        >
          {error}
        </div>
      )}

      <section className="mt-6 overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-start text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">{t("platform.audit.actionHeader")}</th>
              <th className="px-3 py-3 font-medium">{t("platform.audit.resourceHeader")}</th>
              <th className="px-3 py-3 font-medium">{t("platform.audit.outcomeHeader")}</th>
              <th className="px-3 py-3 font-medium">{t("platform.audit.whenHeader")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {!loading && entries.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-zinc-400">
                  {t("platform.audit.empty")}
                </td>
              </tr>
            )}
            {entries.map((entry) => (
              <tr key={entry.id} className="hover:bg-zinc-50">
                <td className="px-4 py-3">
                  <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-700">
                    {entry.action}
                  </code>
                </td>
                <td className="px-3 py-3 text-xs text-zinc-500">
                  {entry.resource_type ?? "—"}
                  {entry.resource_id ? (
                    <span className="ms-1 font-mono">{entry.resource_id.slice(0, 8)}…</span>
                  ) : null}
                </td>
                <td className="px-3 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                      entry.success
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                        : "bg-red-50 text-red-700 ring-red-200"
                    }`}
                  >
                    {entry.success ? t("status.succeeded") : t("status.failed")}
                  </span>
                </td>
                <td className="px-3 py-3 text-xs text-zinc-500">
                  {new Date(entry.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}