"use client";

import { useCallback, useEffect, useState } from "react";
import ReauthModal from "@/components/admin/ReauthModal";
import { useElevatedAction } from "@/components/admin/cloud/CloudReauth";
import { cloudApi, type CloudSnapshot } from "@/components/admin/cloud/CloudApi";
import CloudBadge from "@/components/admin/cloud/CloudBadge";
import { formatDate } from "@/components/admin/cloud/formatDate";
import { useAdminI18n } from "@/i18n/LanguageProvider";

interface CloudSnapshotsPanelProps {
  projectId: string;
}

/**
 * Immutable point-in-time records of the workspace HEAD ref. Restore is a safe
 * `git checkout` that refuses a dirty tree — it is an elevated, confirm-gated
 * action.
 */
export default function CloudSnapshotsPanel({ projectId }: CloudSnapshotsPanelProps) {
  const { t } = useAdminI18n();
  const [snapshots, setSnapshots] = useState<CloudSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<CloudSnapshot | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { snapshots: list } = await cloudApi.snapshots.list(projectId);
      setSnapshots(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cloud.snapshots.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const { pending, queue, cancel, onReauthenticated } = useElevatedAction(() => {
    setConfirmRestore(null);
    void refresh();
  });

  useEffect(() => {
    let cancelled = false;
    cloudApi.snapshots
      .list(projectId)
      .then(({ snapshots: list }) => {
        if (cancelled) return;
        setSnapshots(list);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("cloud.snapshots.loadFailed"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  function createSnapshot() {
    if (!reason.trim()) return;
    const message = reason.trim();
    setReason("");
    setShowCreate(false);
    queue(t("cloud.snapshots.create"), t("cloud.snapshots.queue.createDesc"), async () => {
      await cloudApi.snapshots.create(projectId, message);
      setNotice(t("cloud.snapshots.createdNotice"));
      void refresh();
    });
  }

  function restore(snapshot: CloudSnapshot) {
    queue(
      t("cloud.snapshots.queue.restoreTitle"),
      t("cloud.snapshots.queue.restoreDesc", { ref: snapshot.ref }),
      async () => {
        const res = await cloudApi.snapshots.restore(projectId, snapshot.id);
        setNotice(t("cloud.snapshots.restoredNotice", { ref: res.ref }));
      }
    );
  }

  return (
    <div className="space-y-4">
      {notice ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {loading
            ? t("common.loading")
            : `${snapshots.length} ${t(
                snapshots.length === 1 ? "cloud.snapshots.snapshotOne" : "cloud.snapshots.snapshotMany"
              )}`}
        </p>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {t("cloud.snapshots.create")}
        </button>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">{t("cloud.snapshots.ref")}</th>
                <th className="px-4 py-3 font-medium">{t("cloud.snapshots.reason")}</th>
                <th className="px-4 py-3 font-medium">{t("common.status")}</th>
                <th className="px-4 py-3 font-medium">{t("common.created")}</th>
                <th className="px-4 py-3 font-medium">{t("cloud.snapshots.restore")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {snapshots.map((snapshot) => (
                <tr key={snapshot.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                      {snapshot.ref.slice(0, 10)}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{snapshot.reason}</td>
                  <td className="px-4 py-3"><CloudBadge status={snapshot.status} /></td>
                  <td className="px-4 py-3 text-xs text-slate-400">{formatDate(snapshot.created_at)}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setConfirmRestore(snapshot)}
                      className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:border-indigo-300 hover:text-indigo-600"
                    >
                      {t("cloud.snapshots.restore")}
                    </button>
                  </td>
                </tr>
              ))}
              {snapshots.length === 0 && !loading ? (
                <tr><td colSpan={5} className="px-4 py-6 text-sm text-slate-400">{t("cloud.snapshots.noneYet")}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {showCreate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">{t("cloud.snapshots.create")}</h2>
            <textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder={t("cloud.snapshots.whyPrompt")}
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">{t("common.cancel")}</button>
              <button onClick={createSnapshot} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">{t("common.create")}</button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmRestore ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">{t("cloud.snapshots.restoreConfirmTitle")}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {t("cloud.snapshots.restoreConfirmBody")}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">{confirmRestore.ref.slice(0, 12)}</code>.
              {t("cloud.snapshots.restoreConfirmRequires")}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirmRestore(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">{t("common.cancel")}</button>
              <button onClick={() => restore(confirmRestore)} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">{t("cloud.snapshots.restore")}</button>
            </div>
          </div>
        </div>
      ) : null}

      <ReauthModal
        open={pending !== null}
        onClose={cancel}
        onReauthenticated={onReauthenticated}
        title={pending?.title}
        description={pending?.description}
      />
    </div>
  );
}