"use client";

import { useState } from "react";
import type { ApprovalSummary } from "@/server/admin/userApproval";
import ReauthModal from "@/components/admin/ReauthModal";
import { useAdminI18n } from "@/i18n/LanguageProvider";
import type { TranslationKey } from "@/i18n/translations/en";

type Tab = "pending" | "approved" | "rejected" | "disabled";

type ActionStatus = "approved" | "rejected" | "disabled";

const TABS: { key: Tab; label: TranslationKey }[] = [
  { key: "pending", label: "people.status.pending" },
  { key: "approved", label: "people.status.approved" },
  { key: "rejected", label: "people.status.rejected" },
  { key: "disabled", label: "people.status.disabled" },
];

const STATUS_LABEL: Record<ApprovalSummary["status"], TranslationKey> = {
  active: "people.status.active",
  approved: "people.status.approved",
  pending: "people.status.pending",
  rejected: "people.status.rejected",
  disabled: "people.status.disabled",
};

interface PendingAction {
  userId: string;
  status: ActionStatus;
  email: string;
}

const ACTION_TITLES: Record<ActionStatus, TranslationKey> = {
  approved: "people.approvals.actionApprove",
  rejected: "people.approvals.actionReject",
  disabled: "people.approvals.actionDisable",
};

const ACTION_DESCRIPTIONS: Record<ActionStatus, TranslationKey> = {
  approved: "people.approvals.descApprove",
  rejected: "people.approvals.descReject",
  disabled: "people.approvals.descDisable",
};

/**
 * Registration-approval workflow. Lists accounts by status and lets the admin
 * approve/reject/disable. Every mutation first passes through a confirmation
 * re-auth modal and is re-enforced server-side by requireAdmin() with a fresh
 * 30-second window.
 */
export default function ApprovalsManager({
  initialPending,
}: {
  initialPending: ApprovalSummary[];
}) {
  const { t } = useAdminI18n();
  const [tab, setTab] = useState<Tab>("pending");
  const [users, setUsers] = useState<ApprovalSummary[]>(initialPending);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  async function switchTab(next: Tab) {
    setTab(next);
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/approval?status=${next}`, {
        cache: "no-store",
      });
      const body = (await res.json()) as {
        users?: ApprovalSummary[];
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(body.error?.message ?? t("people.approvals.loadError"));
      setUsers(body.users ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("people.approvals.loadError"));
    } finally {
      setLoading(false);
    }
  }

  async function runAction(action: PendingAction) {
    setPendingAction(null);
    setBusyId(action.userId);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/approval", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: action.userId, status: action.status }),
      });
      const body = (await res.json()) as {
        user?: ApprovalSummary;
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(body.error?.message ?? t("people.approvals.actionError"));
      const userStatus = body.user?.status ?? "pending";
      setNotice(
        t("people.approvals.confirmNotice", {
          email: body.user?.email ?? t("people.accounts.account"),
          status: t(STATUS_LABEL[userStatus]),
        })
      );
      // Re-fetch the current tab so moved accounts disappear immediately.
      await switchTab(tab);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("people.approvals.actionError"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((tabItem) => (
          <button
            key={tabItem.key}
            type="button"
            onClick={() => switchTab(tabItem.key)}
            className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium ${
              tab === tabItem.key
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t(tabItem.label)}
          </button>
        ))}
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-emerald-200"
        >
          {notice}
        </div>
      )}

      <section className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-start text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">{t("people.accounts.account")}</th>
              <th className="px-3 py-3 font-medium">{t("people.accounts.role")}</th>
              <th className="px-3 py-3 font-medium">{t("common.status")}</th>
              <th className="px-3 py-3 font-medium">{t("people.approvals.joined")}</th>
              <th className="px-3 py-3 text-end">{t("people.approvals.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">
                  {t("common.loading")}
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">
                  {t("people.approvals.noAccounts")}
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">
                      {user.displayName || t("people.accounts.noName")}
                    </p>
                    <p className="text-xs text-slate-500">{user.email}</p>
                  </td>
                  <td className="px-3 py-3">
                    <RoleBadge role={user.role} />
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                        user.status === "approved" || user.status === "active"
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                          : user.status === "pending"
                            ? "bg-amber-50 text-amber-700 ring-amber-200"
                            : "bg-red-50 text-red-700 ring-red-200"
                      }`}
                    >
                      {t(STATUS_LABEL[user.status])}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-500">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-2">
                      {user.status !== "approved" && user.status !== "active" && (
                        <button
                          type="button"
                          disabled={busyId === user.id}
                          onClick={() =>
                            setPendingAction({ userId: user.id, status: "approved", email: user.email })
                          }
                          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {t("people.approvals.approve")}
                        </button>
                      )}
                      {user.status === "pending" && (
                        <button
                          type="button"
                          disabled={busyId === user.id}
                          onClick={() =>
                            setPendingAction({ userId: user.id, status: "rejected", email: user.email })
                          }
                          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {t("people.approvals.reject")}
                        </button>
                      )}
                      {(user.status === "approved" || user.status === "active") && (
                        <button
                          type="button"
                          disabled={busyId === user.id}
                          onClick={() =>
                            setPendingAction({ userId: user.id, status: "disabled", email: user.email })
                          }
                          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {t("people.approvals.disable")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <ReauthModal
        open={pendingAction !== null}
        onClose={() => setPendingAction(null)}
        onReauthenticated={() => {
          const action = pendingAction;
          if (action) void runAction(action);
        }}
        title={pendingAction ? t(ACTION_TITLES[pendingAction.status]) : t("people.approvals.confirmTitle")}
        description={
          pendingAction
            ? t(ACTION_DESCRIPTIONS[pendingAction.status], { email: pendingAction.email })
            : t("people.approvals.confirmDescription")
        }
      />
    </div>
  );
}

function RoleBadge({ role }: { role: ApprovalSummary["role"] }) {
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
