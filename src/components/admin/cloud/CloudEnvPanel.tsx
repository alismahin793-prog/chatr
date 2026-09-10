"use client";

import { useCallback, useEffect, useState } from "react";
import ReauthModal from "@/components/admin/ReauthModal";
import { useElevatedAction } from "@/components/admin/cloud/CloudReauth";
import { cloudApi, type EnvVar } from "@/components/admin/cloud/CloudApi";
import CloudBadge from "@/components/admin/cloud/CloudBadge";
import { formatDate } from "@/components/admin/cloud/formatDate";
import { useAdminI18n } from "@/i18n/LanguageProvider";

interface CloudEnvPanelProps {
  projectId: string;
}

/**
 * Environment variables. Values are NEVER stored in the database — they are
 * pushed in-flight to the deployment provider's secret store (e.g. Vercel),
 * and the console only shows {name, configured, updatedAt} metadata.
 */
export default function CloudEnvPanel({ projectId }: CloudEnvPanelProps) {
  const { t } = useAdminI18n();
  const [providerConfigured, setProviderConfigured] = useState(false);
  const [vars, setVars] = useState<EnvVar[]>([]);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { environment } = await cloudApi.env.list(projectId);
      setProviderConfigured(environment.providerConfigured);
      setVars(environment.vars);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cloud.env.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const { pending, queue, cancel, onReauthenticated } = useElevatedAction(() => {
    setError(null);
    setShowForm(false);
    void refresh();
  });

  useEffect(() => {
    let cancelled = false;
    cloudApi.env
      .list(projectId)
      .then(({ environment }) => {
        if (cancelled) return;
        setProviderConfigured(environment.providerConfigured);
        setVars(environment.vars);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("cloud.env.loadFailed"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  function addVar() {
    const key = name.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || !value) {
      setError(t("cloud.env.validationError"));
      return;
    }
    queue(
      t("cloud.env.queue.setTitle"),
      t("cloud.env.queue.setDesc", { name: key }),
      async () => {
        await cloudApi.env.set(projectId, key, value);
        const storedValue = value;
        setName("");
        setValue("");
        setTimeout(() => setSaved((prev) => ({ ...prev, [key]: storedValue })), 1000);
        setNotice(t("cloud.env.setNotice", { name: key }));
        await refresh();
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
          <p className="text-sm font-medium text-slate-800">{t("cloud.env.secretStore")}</p>
          {providerConfigured ? (
            <p className="text-xs text-emerald-600">{t("cloud.env.configuredNote")}</p>
          ) : (
            <p className="text-xs text-amber-600">{t("cloud.env.notConfiguredNote")}</p>
          )}
        </div>
        <button
          onClick={() => setShowForm(true)}
          disabled={!providerConfigured}
          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("cloud.env.setVariable")}
        </button>
      </section>

      <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
        {t("cloud.env.infoBefore")}
        <code className="font-mono">VERCEL_TOKEN</code>
        {t("cloud.env.infoAfter")}
      </p>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">{t("common.name")}</th>
                <th className="px-4 py-3 font-medium">{t("cloud.env.state")}</th>
                <th className="px-4 py-3 font-medium">{t("common.updated")}</th>
                <th className="px-4 py-3 font-medium">{t("common.value")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vars.map((variable) => (
                <tr key={variable.name} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-sm font-medium text-slate-800">{variable.name}</td>
                  <td className="px-4 py-3">
                    {variable.configured ? <CloudBadge status="ready" /> : <CloudBadge status="error" />}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{formatDate(variable.updatedAt)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {variable.configured ? (
                      saved[variable.name] !== undefined ? t("cloud.env.justSet") : t("cloud.env.setHidden")
                    ) : (
                      <span className="text-slate-300">{t("cloud.env.notSet")}</span>
                    )}
                  </td>
                </tr>
              ))}
              {vars.length === 0 && !loading ? (
                <tr><td colSpan={4} className="px-4 py-6 text-sm text-slate-400">{t("cloud.env.noneYet")}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {showForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">{t("cloud.env.queue.setTitle")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("cloud.env.formNote")}</p>
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                addVar();
              }}
            >
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{t("common.name")}</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value.toUpperCase())}
                  placeholder="MY_SECRET"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{t("common.value")}</span>
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  type="password"
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
                />
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">{t("common.cancel")}</button>
                <button type="submit" className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">{t("cloud.env.setVariable")}</button>
              </div>
            </form>
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