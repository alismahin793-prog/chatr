"use client";

import { useAdminI18n } from "@/i18n/LanguageProvider";
import type { AiRequestLogRow } from "@/server/ai/usage";

interface AiLogsTableProps {
  logs: AiRequestLogRow[];
}

export default function AiLogsTable({ logs }: AiLogsTableProps) {
  const { t } = useAdminI18n();

  if (logs.length === 0) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-400">
        {t("pages.aiLogs.noLogs")}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-start text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">{t("pages.aiLogs.headerWhen")}</th>
            <th className="px-3 py-3 font-medium">{t("pages.aiLogs.headerUser")}</th>
            <th className="px-3 py-3 font-medium">{t("pages.aiLogs.headerProvider")}</th>
            <th className="px-3 py-3 font-medium">{t("pages.aiLogs.headerModel")}</th>
            <th className="px-3 py-3 font-medium">{t("pages.aiLogs.headerConversation")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {logs.map((log) => (
            <tr key={log.id} className="hover:bg-slate-50">
              <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                {new Date(log.createdAt).toLocaleString()}
              </td>
              <td className="px-3 py-3">
                <p className="font-medium text-slate-900">
                  {log.userEmail ?? "unknown"}
                </p>
                <p className="font-mono text-[11px] text-slate-400">
                  {log.userId.slice(0, 8)}…
                </p>
              </td>
              <td className="px-3 py-3 text-slate-700">{log.provider}</td>
              <td className="px-3 py-3">
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
                  {log.model}
                </code>
              </td>
              <td className="px-3 py-3 font-mono text-xs text-slate-500">
                {log.conversationId ? `${log.conversationId.slice(0, 8)}…` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
