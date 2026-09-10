"use client";

import { useAdminI18n } from "@/i18n/LanguageProvider";

interface AiUsageCardsProps {
  total: number;
  today: number;
  last7Days: { date: string; count: number }[];
  byProvider: [string, number][];
  byModel: [string, number][];
}

export default function AiUsageCards({
  total,
  today,
  last7Days,
  byProvider,
  byModel,
}: AiUsageCardsProps) {
  const { t } = useAdminI18n();

  const maxDay = Math.max(1, ...last7Days.map((d) => d.count));

  return (
    <>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-sm font-medium text-zinc-500">{t("pages.ai.totalRequests")}</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900">{total}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-sm font-medium text-zinc-500">{t("pages.ai.requestsToday")}</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900">{today}</p>
        </div>
      </div>

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="text-base font-semibold text-zinc-900">{t("pages.ai.last7Days")}</h2>
        <div className="mt-4 flex h-40 items-end gap-3">
          {last7Days.map((day) => (
            <div key={day.date} className="flex flex-1 flex-col items-center gap-2">
              <div className="flex w-full flex-1 items-end">
                <div
                  className="w-full rounded-t-md bg-indigo-600"
                  style={{
                    height: `${Math.max(4, (day.count / maxDay) * 100)}%`,
                  }}
                />
              </div>
              <span className="text-[10px] text-zinc-400">{day.date.slice(5)}</span>
              <span className="text-xs font-medium text-zinc-700">{day.count}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white p-5">
          <h2 className="text-base font-semibold text-zinc-900">{t("pages.ai.byProvider")}</h2>
          <UsageBreakdown rows={byProvider} />
        </section>
        <section className="rounded-xl border border-zinc-200 bg-white p-5">
          <h2 className="text-base font-semibold text-zinc-900">{t("pages.ai.byModel")}</h2>
          <UsageBreakdown rows={byModel} />
        </section>
      </div>
    </>
  );
}

function UsageBreakdown({ rows }: { rows: [string, number][] }) {
  const { t } = useAdminI18n();

  if (rows.length === 0) {
    return <p className="mt-3 text-sm text-zinc-400">{t("pages.ai.noRequestsRecorded")}</p>;
  }
  return (
    <ul className="mt-3 divide-y divide-zinc-100 text-sm">
      {rows.map(([key, count]) => (
        <li key={key} className="flex items-center justify-between py-2">
          <span className="font-medium text-zinc-700">{key}</span>
          <span className="text-zinc-500">{count}</span>
        </li>
      ))}
    </ul>
  );
}
