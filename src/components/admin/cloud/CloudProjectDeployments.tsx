"use client";

import { useCallback, useEffect, useState } from "react";
import ReauthModal from "@/components/admin/ReauthModal";
import Link from "next/link";
import { useElevatedAction } from "@/components/admin/cloud/CloudReauth";
import { cloudApi, type CloudDeployment } from "@/components/admin/cloud/CloudApi";
import CloudBadge from "@/components/admin/cloud/CloudBadge";
import { formatDate } from "@/components/admin/cloud/formatDate";
import { useAdminI18n } from "@/i18n/LanguageProvider";

interface CloudProjectDeploymentsProps {
  projectId: string;
}

/**
 * Deployments for one project. New deployments POST to the real deployment
 * provider (Vercel); rollback requires a confirmed, elevated action and issues
 * a fresh deployment from the deployment's commit.
 */
export default function CloudProjectDeployments({ projectId }: CloudProjectDeploymentsProps) {
  const { t } = useAdminI18n();
  const [deployments, setDeployments] = useState<CloudDeployment[]>([]);
  const [providerConfigured, setProviderConfigured] = useState(false);
  const [providerReason, setProviderReason] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<CloudDeployment | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [{ deployments: list }, providers] = await Promise.all([
        cloudApi.deployments.list(projectId),
        cloudApi.providers(),
      ]);
      setDeployments(list);
      setProviderConfigured(providers.providers.deployment.configured);
      setProviderReason(providers.providers.deployment.reason);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cloud.deployments.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const { pending, queue, cancel, onReauthenticated } = useElevatedAction(() => {
    setRollbackTarget(null);
    void refresh();
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([cloudApi.deployments.list(projectId), cloudApi.providers()])
      .then(([{ deployments: list }, providers]) => {
        if (cancelled) return;
        setDeployments(list);
        setProviderConfigured(providers.providers.deployment.configured);
        setProviderReason(providers.providers.deployment.reason);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("cloud.deployments.loadFailed"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  function deploy(kind: "production" | "preview") {
    queue(
      kind === "production" ? t("cloud.deployments.queue.prodTitle") : t("cloud.deployments.queue.previewTitle"),
      kind === "production" ? t("cloud.deployments.queue.prodDesc") : t("cloud.deployments.queue.previewDesc"),
      async () => {
        const res = await cloudApi.deployments.create({ projectId, kind });
        setNotice(
          kind === "production"
            ? t("cloud.deployments.deploymentStarted", { status: res.deployment.status })
            : t("cloud.deployments.previewStarted", { status: res.deployment.status })
        );
        void refresh();
      }
    );
  }

  function rollback(deployment: CloudDeployment) {
    queue(
      t("cloud.deployments.queue.rollbackTitle"),
      t("cloud.deployments.queue.rollbackDesc", { ref: deployment.ref.slice(0, 10) }),
      async () => {
        const res = await cloudApi.deployments.rollback(deployment.id);
        setNotice(
          t("cloud.deployments.rollbackIssued", {
            from: res.rollback.from,
            to: res.rollback.to,
            ref: res.rollback.ref.slice(0, 10),
          })
        );
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

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div>
          <p className="text-sm font-medium text-slate-800">{t("cloud.deployments.providerLabel")}</p>
          {providerConfigured ? (
            <p className="text-xs text-emerald-600">{t("cloud.deployments.providerConfigured")}</p>
          ) : (
            <p className="text-xs text-amber-600">{providerReason ?? t("cloud.deployments.providerNotConfigured")}</p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => deploy("production")}
            disabled={!providerConfigured}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("cloud.deployments.deployProduction")}
          </button>
          <button
            onClick={() => deploy("preview")}
            disabled={!providerConfigured}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-indigo-300 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("cloud.deployments.previewDeploy")}
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">{t("cloud.deployments.type")}</th>
                <th className="px-4 py-3 font-medium">{t("common.status")}</th>
                <th className="px-4 py-3 font-medium">{t("cloud.git.commit")}</th>
                <th className="px-4 py-3 font-medium">{t("cloud.deployments.url")}</th>
                <th className="px-4 py-3 font-medium">{t("common.created")}</th>
                <th className="px-4 py-3 font-medium">{t("cloud.deployments.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {deployments.map((deployment) => (
                <tr key={deployment.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${
                        deployment.kind === "production"
                          ? "bg-slate-900 text-white ring-slate-900"
                          : "bg-indigo-50 text-indigo-700 ring-indigo-200"
                      }`}
                    >
                      {deployment.kind}
                    </span>
                  </td>
                  <td className="px-4 py-3"><CloudBadge status={deployment.status} /></td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                      {deployment.ref.slice(0, 10)}
                    </code>
                    {deployment.branch ? <span className="ms-2 text-xs text-slate-400">{deployment.branch}</span> : null}
                  </td>
                  <td className="px-4 py-3">
                    {deployment.url ? (
                      <a
                        href={deployment.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-600 hover:underline"
                      >
                        {deployment.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                      </a>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{formatDate(deployment.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {deployment.status === "ready" && deployment.kind === "production" && !deployment.rolled_back_at ? (
                        <button
                          onClick={() => setRollbackTarget(deployment)}
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:border-rose-300 hover:text-rose-600"
                        >
                          {t("cloud.deployments.rollback")}
                        </button>
                      ) : deployment.status === "building" || deployment.status === "queued" ? (
                        <button
                          onClick={() => void cancelDeploy(deployment)}
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:border-amber-300 hover:text-amber-600"
                        >
                          {t("common.cancel")}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {deployments.length === 0 && !loading ? (
                <tr><td colSpan={6} className="px-4 py-6 text-sm text-slate-400">{t("cloud.deployments.noneYet")}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {rollbackTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">{t("cloud.deployments.rollbackConfirmTitle")}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {t("cloud.deployments.rollbackConfirmBody")}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">{rollbackTarget.ref.slice(0, 12)}</code>.
              {t("cloud.deployments.rollbackConfirmRequires")}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setRollbackTarget(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">{t("common.cancel")}</button>
              <button onClick={() => rollback(rollbackTarget)} className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700">{t("cloud.deployments.rollback")}</button>
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

async function cancelDeploy(deployment: CloudDeployment) {
  await cloudApi.deployments.cancel(deployment.id);
}

/** Global deployments table across all projects. */
export function CloudDeploymentsGlobal() {
  const { t } = useAdminI18n();
  const [deployments, setDeployments] = useState<CloudDeployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cloudApi.deployments
      .list()
      .then(({ deployments }) => setDeployments(deployments))
      .catch((err) => setError(err instanceof Error ? err.message : t("cloud.deployments.loadFailed")))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">{t("cloud.deployments.project")}</th>
                <th className="px-4 py-3 font-medium">{t("cloud.deployments.type")}</th>
                <th className="px-4 py-3 font-medium">{t("common.status")}</th>
                <th className="px-4 py-3 font-medium">{t("cloud.git.commit")}</th>
                <th className="px-4 py-3 font-medium">{t("cloud.deployments.url")}</th>
                <th className="px-4 py-3 font-medium">{t("common.created")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {deployments.map((deployment) => (
                <tr key={deployment.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/cloud/projects/${deployment.project_id}`} className="text-indigo-600 hover:underline">
                      {deployment.project_id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{deployment.kind}</td>
                  <td className="px-4 py-3"><CloudBadge status={deployment.status} /></td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                      {deployment.ref.slice(0, 10)}
                    </code>
                  </td>
                  <td className="px-4 py-3">
                    {deployment.url ? (
                      <a href={deployment.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                        {deployment.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                      </a>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{formatDate(deployment.created_at)}</td>
                </tr>
              ))}
              {deployments.length === 0 && !loading ? (
                <tr><td colSpan={6} className="px-4 py-6 text-sm text-slate-400">{t("cloud.deployments.noneConfigured")}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}