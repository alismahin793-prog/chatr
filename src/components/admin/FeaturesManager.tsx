"use client";

import { useCallback, useEffect, useState } from "react";
import ReauthModal from "@/components/admin/ReauthModal";
import AdminSection from "@/components/admin/AdminSection";
import { useAdminI18n } from "@/i18n/LanguageProvider";

export interface FeatureRow {
  id: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  availableToUsers: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

type Pending = {
  title: string;
  description: string;
  run: () => Promise<void>;
} | null;

/**
 * Features Manager. Viewing the registry is open to any admin; toggling a
 * feature goes through the 30-second re-auth modal and is enforced server-side
 * by requireSensitivePermission(manage_features). Disabling a feature makes
 * every server path that enforces it refuse the request.
 */
export default function FeaturesManager() {
  const { t } = useAdminI18n();
  const [features, setFeatures] = useState<FeatureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/features", { cache: "no-store" });
    if (!res.ok) throw new Error(t("platform.features.loadFailed"));
    const body = (await res.json()) as { features: FeatureRow[] };
    setFeatures(body.features);
    setLoading(false);
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/features", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(t("platform.features.loadFailed"));
        const body = (await res.json()) as { features: FeatureRow[] };
        if (cancelled) return;
        setFeatures(body.features);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(t("platform.features.loadFailed"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  function toast(message: string) {
    setNotice(message);
    setError(null);
  }

  function queueToggle(
    feature: FeatureRow,
    patch: { enabled?: boolean; availableToUsers?: boolean }
  ) {
    setPendingKey(feature.key);
    setPending({
      title: t("platform.features.reauthTitle"),
      description: t("platform.features.reauthDesc", { name: feature.name }),
      run: async () => {
        const res = await fetch(`/api/admin/features/${encodeURIComponent(feature.key)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        if (!res.ok) throw new Error(body?.error?.message ?? t("platform.features.updateFailed"));
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
        toast(t("platform.features.featureUpdated"));
        return refresh();
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : t("platform.features.actionFailed"))
      );
  }

  return (
    <div className="max-w-5xl">
      <AdminSection
        titleKey="platform.features.title"
        descriptionKey="platform.features.description"
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

      <section className="mt-6 overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-start text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">{t("platform.features.featureHeader")}</th>
              <th className="px-3 py-3 font-medium">{t("platform.features.stateHeader")}</th>
              <th className="px-3 py-3 font-medium">{t("platform.features.userVisibleHeader")}</th>
              <th className="px-3 py-3 font-medium">{t("platform.features.versionHeader")}</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {!loading && features.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-zinc-400">
                  {t("platform.features.empty")}
                </td>
              </tr>
            )}
            {features.map((feature) => (
              <tr key={feature.id} className="hover:bg-zinc-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-zinc-900">{feature.name}</p>
                  <p className="text-xs text-zinc-500">
                    <code className="font-mono">{feature.key}</code>
                    {feature.description ? ` — ${feature.description}` : ""}
                  </p>
                </td>
                <td className="px-3 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                      feature.enabled
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                        : "bg-red-50 text-red-700 ring-red-200"
                    }`}
                  >
                    {feature.enabled ? t("platform.features.enabled") : t("platform.features.disabled")}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                      feature.availableToUsers
                        ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
                        : "bg-zinc-100 text-zinc-500 ring-zinc-200"
                    }`}
                  >
                    {feature.availableToUsers ? t("platform.features.visible") : t("platform.features.hidden")}
                  </span>
                </td>
                <td className="px-3 py-3 text-zinc-600">{feature.version}</td>
                <td className="px-3 py-3 text-end">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        queueToggle(feature, {
                          availableToUsers: !feature.availableToUsers,
                        })
                      }
                      className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
                    >
                      {feature.availableToUsers ? t("platform.features.hideFromUsers") : t("platform.features.showToUsers")}
                    </button>
                    <button
                      type="button"
                      onClick={() => queueToggle(feature, { enabled: !feature.enabled })}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium text-white ${
                        feature.enabled
                          ? "bg-red-600 hover:bg-red-700"
                          : "bg-emerald-600 hover:bg-emerald-700"
                      }`}
                    >
                      {feature.enabled ? t("platform.features.disable") : t("platform.features.enable")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <ReauthModal
        open={pending !== null}
        onClose={() => {
          setPending(null);
          setPendingKey(null);
        }}
        onReauthenticated={onReauthenticated}
        title={pending?.title ?? t("reauth.title")}
        description={
          pending?.description ??
          t("reauth.description")
        }
      />
      <span className="sr-only">{pendingKey ?? ""}</span>
    </div>
  );
}