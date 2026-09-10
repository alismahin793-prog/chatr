"use client";

import { useAdminI18n } from "@/i18n/LanguageProvider";

interface SystemHealthCardsProps {
  status: string;
  database: string;
  userCount: number;
  timestamp: string;
  errors: { id: string; action: string; message: string; createdAt: string }[] | null;
}

export default function SystemHealthCards({
  status,
  database,
  userCount,
  timestamp,
  errors,
}: SystemHealthCardsProps) {
  const { t } = useAdminI18n();

  return (
    <>
      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        <HealthCard
          label={t("pages.system.status")}
          value={status === "ok" ? t("pages.system.ok") : t("pages.system.degraded")}
          tone={status === "ok" ? "emerald" : "red"}
        />
        <HealthCard
          label={t("pages.system.database")}
          value={database === "ok" ? t("pages.system.connected") : t("pages.system.unreachable")}
          tone={database === "ok" ? "emerald" : "red"}
        />
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-sm font-medium text-zinc-500">{t("pages.system.users")}</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900">{userCount}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-sm font-medium text-zinc-500">{t("pages.system.checkedAt")}</p>
          <p className="mt-1 text-sm font-medium text-zinc-700">
            {new Date(timestamp).toLocaleString()}
          </p>
        </div>
      </div>

      <section className="mt-8 rounded-xl border border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 px-5 py-4">
          <h2 className="text-base font-semibold text-zinc-900">{t("pages.system.recentFailedActions")}</h2>
        </div>
        {errors === null || errors.length === 0 ? (
          <p className="px-5 py-6 text-sm text-zinc-400">{t("pages.system.noFailedActions")}</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {errors.map((entry) => (
              <li key={entry.id} className="px-5 py-3 text-sm">
                <div className="flex items-center gap-3">
                  <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-700">
                    {entry.action}
                  </code>
                  <span className="flex-1 truncate text-zinc-500">{entry.message}</span>
                  <span className="shrink-0 text-xs text-zinc-400">
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function HealthCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "emerald" | "red";
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <p className="text-sm font-medium text-zinc-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${
          tone === "emerald" ? "text-emerald-700" : "text-red-700"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
