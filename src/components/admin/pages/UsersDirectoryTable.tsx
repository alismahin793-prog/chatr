"use client";

import { useAdminI18n } from "@/i18n/LanguageProvider";
import type { AccountSummary } from "@/server/admin/accounts";

interface UsersDirectoryTableProps {
  accounts: AccountSummary[];
}

export default function UsersDirectoryTable({ accounts }: UsersDirectoryTableProps) {
  const { t } = useAdminI18n();

  if (accounts.length === 0) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-400">
        {t("pages.users.noAccounts")}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-start text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">{t("pages.users.headerUser")}</th>
            <th className="px-3 py-3 font-medium">{t("pages.users.headerRole")}</th>
            <th className="px-3 py-3 font-medium">{t("pages.users.headerStatus")}</th>
            <th className="px-3 py-3 font-medium">{t("pages.users.headerType")}</th>
            <th className="px-3 py-3 font-medium">{t("pages.users.headerPermissions")}</th>
            <th className="px-3 py-3 font-medium">{t("pages.users.headerJoined")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {accounts.map((account) => (
            <tr key={account.id} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <p className="font-medium text-slate-900">
                  {account.displayName || t("pages.users.noName")}
                </p>
                <p className="text-xs text-slate-500">{account.email}</p>
              </td>
              <td className="px-3 py-3">
                <RoleChip role={account.role} />
              </td>
              <td className="px-3 py-3">
                <StatusChip status={account.status} />
              </td>
              <td className="px-3 py-3">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                    account.isTestUser
                      ? "bg-violet-50 text-violet-700 ring-violet-200"
                      : "bg-slate-100 text-slate-600 ring-slate-200"
                  }`}
                >
                  {account.isTestUser ? t("pages.users.test") : t("pages.users.member")}
                </span>
              </td>
              <td className="px-3 py-3">
                {account.permissionIds.length === 0 ? (
                  <span className="text-xs text-slate-400">—</span>
                ) : (
                  <span className="text-xs text-slate-600">
                    {account.permissionIds.join(", ")}
                  </span>
                )}
              </td>
              <td className="px-3 py-3 text-xs text-slate-500">
                {new Date(account.createdAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoleChip({ role }: { role: AccountSummary["role"] }) {
  const isSuperAdmin = role === "super_admin";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
        isSuperAdmin
          ? "bg-slate-900 text-white ring-slate-900"
          : "bg-slate-100 text-slate-600 ring-slate-200"
      }`}
    >
      {role ?? "none"}
    </span>
  );
}

function StatusChip({ status }: { status: AccountSummary["status"] }) {
  const tone =
    status === "approved" || status === "active"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : status === "pending"
        ? "bg-amber-50 text-amber-700 ring-amber-200"
        : "bg-red-50 text-red-700 ring-red-200";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${tone}`}>
      {status}
    </span>
  );
}
