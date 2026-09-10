"use client";

import { useState } from "react";
import AdminSection from "@/components/admin/AdminSection";
import { useAdminI18n } from "@/i18n/LanguageProvider";
import type { TranslationKey } from "@/i18n/translations/en";

export interface AccountRow {
  id: string;
  email: string;
  displayName: string | null;
  role: "user" | "super_admin" | null;
  status: "active" | "approved" | "pending" | "rejected" | "disabled";
  isTestUser: boolean;
  expiresAt: string | null;
  createdAt: string;
  permissionIds: string[];
}

export interface AccountDetail extends AccountRow {
  capabilityIds: string[];
  conversationCount: number;
}

const STATUS_LABEL: Record<NonNullable<AccountRow["status"]>, TranslationKey> = {
  active: "people.status.active",
  approved: "people.status.approved",
  pending: "people.status.pending",
  rejected: "people.status.rejected",
  disabled: "people.status.disabled",
};

/**
 * Account directory search. Read-only: searches by email/display name and lets
 * the admin expand a row to see admin permissions, app capabilities, and usage
 * counts. All enforcement happens server-side (view_users).
 */
export default function AccountsManager() {
  const { t } = useAdminI18n();
  const [query, setQuery] = useState("");
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setDetail(null);
    try {
      const res = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const body = (await res.json()) as { accounts?: AccountRow[]; error?: { message?: string } };
      if (!res.ok) throw new Error(body.error?.message ?? t("people.accounts.loadError"));
      setAccounts(body.accounts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("people.accounts.loadError"));
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/admin/accounts/${id}`, { cache: "no-store" });
      const body = (await res.json()) as { account?: AccountDetail; error?: { message?: string } };
      if (!res.ok) throw new Error(body.error?.message ?? t("people.accounts.loadDetailError"));
      setDetail(body.account ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("people.accounts.loadDetailError"));
    }
  }

  return (
    <div className="max-w-6xl">
      <AdminSection
        titleKey="people.accounts.title"
        descriptionKey="people.accounts.description"
      />

      <form onSubmit={search} className="mt-6 flex max-w-xl gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("people.accounts.searchPlaceholder")}
          className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? t("people.accounts.searching") : t("common.search")}
        </button>
      </form>

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
              <th className="px-4 py-3 font-medium">{t("people.accounts.account")}</th>
              <th className="px-3 py-3 font-medium">{t("people.accounts.role")}</th>
              <th className="px-3 py-3 font-medium">{t("common.status")}</th>
              <th className="px-3 py-3 font-medium">{t("people.accounts.type")}</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {accounts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-zinc-400">
                  {query.trim() ? t("people.accounts.emptySearch") : t("people.accounts.searchHint")}
                </td>
              </tr>
            )}
            {accounts.map((account) => (
              <tr key={account.id} className="hover:bg-zinc-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-zinc-900">
                    {account.displayName || t("people.accounts.noName")}
                  </p>
                  <p className="text-xs text-zinc-500">{account.email}</p>
                </td>
                <td className="px-3 py-3">
                  {account.role === "super_admin" ? (
                    <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-200">
                      super_admin
                    </span>
                  ) : (
                    <span className="text-zinc-700">{account.role ?? "—"}</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                      account.status === "disabled" || account.status === "rejected"
                        ? "bg-red-50 text-red-700 ring-red-200"
                        : account.status === "pending"
                          ? "bg-amber-50 text-amber-700 ring-amber-200"
                          : "bg-emerald-50 text-emerald-700 ring-emerald-200"
                    }`}
                  >
                    {t(STATUS_LABEL[account.status])}
                  </span>
                </td>
                <td className="px-3 py-3">
                  {account.isTestUser ? (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                      {t("people.accounts.test")}
                    </span>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </td>
                <td className="px-3 py-3 text-end">
                  <button
                    type="button"
                    onClick={() => openDetail(account.id)}
                    className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
                  >
                    {t("people.accounts.details")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {detail && <AccountDetailsPanel account={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function AccountDetailsPanel({
  account,
  onClose,
}: {
  account: AccountDetail;
  onClose: () => void;
}) {
  const { t } = useAdminI18n();
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-900/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-lg ring-1 ring-zinc-200">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">
              {account.displayName || t("people.accounts.noName")}
            </h2>
            <p className="text-sm text-zinc-500">{account.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100"
          >
            {t("common.close")}
          </button>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
          <Detail label={t("people.accounts.role")} value={account.role ?? "—"} />
          <Detail label={t("common.status")} value={account.status} />
          <Detail label={t("people.accounts.type")} value={account.isTestUser ? t("people.accounts.testUser") : t("people.accounts.regular")} />
          <Detail label={t("common.created")} value={new Date(account.createdAt).toLocaleDateString()} />
          <Detail
            label={t("people.accounts.expires")}
            value={account.expiresAt ? new Date(account.expiresAt).toLocaleDateString() : t("common.never")}
          />
          <Detail label={t("people.accounts.conversations")} value={String(account.conversationCount)} />
        </dl>

        <div className="mt-5">
          <h3 className="text-sm font-semibold text-zinc-900">{t("people.accounts.adminPermissions")}</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {account.permissionIds.length === 0 ? (
              <span className="text-sm text-zinc-400">{t("people.accounts.none")}</span>
            ) : (
              account.permissionIds.map((p) => (
                <span
                  key={p}
                  className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200"
                >
                  {p}
                </span>
              ))
            )}
          </div>
        </div>

        <div className="mt-4">
          <h3 className="text-sm font-semibold text-zinc-900">{t("people.accounts.appCapabilities")}</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {account.capabilityIds.length === 0 ? (
              <span className="text-sm text-zinc-400">{t("people.accounts.none")}</span>
            ) : (
              account.capabilityIds.map((c) => (
                <span
                  key={c}
                  className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200"
                >
                  {c}
                </span>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-zinc-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-zinc-800">{value}</dd>
    </div>
  );
}
