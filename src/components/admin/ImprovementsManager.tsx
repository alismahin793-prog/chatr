"use client";

import { useEffect, useState } from "react";
import ReauthModal from "@/components/admin/ReauthModal";
import AdminSection from "@/components/admin/AdminSection";
import { useAdminI18n } from "@/i18n/LanguageProvider";

export interface ProposalRow {
  id: string;
  title: string;
  description: string;
  status: "proposed" | "approved" | "rejected" | "implemented";
  proposedBy: string | null;
  reviewedBy: string | null;
  reviewComment: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

const STATUS_TONE: Record<ProposalRow["status"], string> = {
  proposed: "bg-amber-50 text-amber-700 ring-amber-200",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rejected: "bg-red-50 text-red-700 ring-red-200",
  implemented: "bg-indigo-50 text-indigo-700 ring-indigo-200",
};

type Pending = {
  title: string;
  description: string;
  run: () => Promise<void>;
} | null;

/**
 * Improvement proposals (self-improvement). Adding a proposal records it in the
 * audit trail — nothing here executes code. Reviewing (approve/reject/implement)
 * is a sensitive action gated by approve_dev_plans + re-auth, enforced
 * server-side.
 */
export default function ImprovementsManager() {
  const { t } = useAdminI18n();
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  async function refresh() {
    const res = await fetch("/api/admin/improvements", { cache: "no-store" });
    if (!res.ok) throw new Error(t("platform.improvements.loadFailed"));
    const body = (await res.json()) as { proposals: ProposalRow[] };
    setProposals(body.proposals);
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/improvements", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(t("platform.improvements.loadFailed"));
        const body = (await res.json()) as { proposals: ProposalRow[] };
        if (cancelled) return;
        setProposals(body.proposals);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(t("platform.improvements.loadFailed"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toast(message: string) {
    setNotice(message);
    setError(null);
  }

  async function createProposal(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/improvements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!res.ok) throw new Error(body?.error?.message ?? t("platform.improvements.submitFailed"));
      setTitle("");
      setDescription("");
      toast(t("platform.improvements.proposalSubmitted"));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("platform.improvements.submitFailed"));
    } finally {
      setCreating(false);
    }
  }

  function queueReview(
    proposal: ProposalRow,
    status: "approved" | "rejected" | "implemented"
  ) {
    const statusLabel = {
      approved: t("platform.improvements.statusApproved"),
      rejected: t("platform.improvements.statusRejected"),
      implemented: t("platform.improvements.statusImplemented"),
    }[status];
    setPending({
      title: t("platform.improvements.reauthReviewTitle"),
      description: t("platform.improvements.reauthReviewDesc", { name: proposal.title, status: statusLabel }),
      run: async () => {
        const comment = window.prompt(t("platform.improvements.reviewPrompt"));
        const res = await fetch(`/api/admin/improvements/${proposal.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status, comment: comment?.trim() || undefined }),
        });
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        if (!res.ok) throw new Error(body?.error?.message ?? t("platform.improvements.reviewFailed"));
      },
    });
  }

  function onReauthenticated() {
    const action = pending;
    setPending(null);
    if (!action) return;
    action
      .run()
      .then(() => {
        toast(t("platform.improvements.proposalUpdated"));
        return refresh();
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : t("platform.improvements.actionFailed"))
      );
  }

  return (
    <div className="max-w-5xl">
      <AdminSection
        titleKey="platform.improvements.title"
        descriptionKey="platform.improvements.description"
      />

      {notice && (
        <div
          role="status"
          className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-emerald-200"
        >
          {notice}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200"
        >
          {error}
        </div>
      )}

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-zinc-900">{t("platform.improvements.submitProposal")}</h2>
        <form onSubmit={createProposal} className="mt-4 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-zinc-700">{t("platform.improvements.titleLabel")}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={160}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-zinc-700">{t("platform.improvements.descriptionLabel")}</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              maxLength={4000}
              rows={4}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
          </label>
          <button
            type="submit"
            disabled={creating}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creating ? t("common.working") : t("platform.improvements.submitProposalButton")}
          </button>
        </form>
      </section>

      <section className="mt-6 overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-start text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">{t("platform.improvements.proposalHeader")}</th>
              <th className="px-3 py-3 font-medium">{t("common.status")}</th>
              <th className="px-3 py-3 font-medium">{t("platform.improvements.submittedHeader")}</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {!loading && proposals.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-zinc-400">
                  {t("platform.improvements.empty")}
                </td>
              </tr>
            )}
            {proposals.map((proposal) => (
              <tr key={proposal.id} className="align-top hover:bg-zinc-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-zinc-900">{proposal.title}</p>
                  <p className="mt-0.5 max-w-xl whitespace-pre-line text-xs text-zinc-500">
                    {proposal.description}
                  </p>
                  {proposal.reviewComment && (
                    <p className="mt-1 text-xs italic text-zinc-500">
                      {t("platform.improvements.reviewLabel")} {proposal.reviewComment}
                    </p>
                  )}
                </td>
                <td className="px-3 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                      STATUS_TONE[proposal.status]
                    }`}
                  >
                    {({ proposed: t("platform.improvements.statusProposed"), approved: t("platform.improvements.statusApproved"), rejected: t("platform.improvements.statusRejected"), implemented: t("platform.improvements.statusImplemented") } as Record<ProposalRow["status"], string>)[proposal.status]}
                  </span>
                </td>
                <td className="px-3 py-3 text-xs text-zinc-500">
                  {new Date(proposal.createdAt).toLocaleString()}
                </td>
                  <td className="px-3 py-3 text-end">
                  {proposal.status === "proposed" ? (
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => queueReview(proposal, "approved")}
                        className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                      >
                        {t("platform.improvements.approve")}
                      </button>
                      <button
                        type="button"
                        onClick={() => queueReview(proposal, "rejected")}
                        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
                      >
                        {t("platform.improvements.reject")}
                      </button>
                    </div>
                  ) : proposal.status === "approved" ? (
                    <button
                      type="button"
                      onClick={() => queueReview(proposal, "implemented")}
                      className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
                    >
                      {t("platform.improvements.markImplemented")}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <ReauthModal
        open={pending !== null}
        onClose={() => setPending(null)}
        onReauthenticated={onReauthenticated}
        title={pending?.title ?? t("reauth.title")}
        description={
          pending?.description ??
          t("reauth.description")
        }
      />
    </div>
  );
}