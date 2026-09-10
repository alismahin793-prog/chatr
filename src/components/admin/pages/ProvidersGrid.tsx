"use client";

import { useAdminI18n } from "@/i18n/LanguageProvider";

interface ProvidersGridProps {
  providers: {
    id: string;
    displayName: string;
    defaultModel: string;
    availableModels: string[];
  }[];
  activeProviderId: string;
  activeModel: string;
  providerUsage: Record<string, number>;
  fallbackChain: string[];
}

export default function ProvidersGrid({
  providers,
  activeProviderId,
  activeModel,
  providerUsage,
  fallbackChain,
}: ProvidersGridProps) {
  const { t } = useAdminI18n();

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {providers.map((provider) => {
          const isActive = provider.id === activeProviderId;
          return (
            <div
              key={provider.id}
              className={`rounded-xl border bg-white p-5 ${
                isActive ? "border-indigo-400 ring-1 ring-indigo-200" : "border-slate-200"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900">{provider.displayName}</p>
                  <p className="font-mono text-[11px] text-slate-400">{provider.id}</p>
                </div>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                    isActive
                      ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
                      : "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  }`}
                >
                  {isActive ? t("pages.providers.active") : t("common.configured")}
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                {t("pages.providers.defaultModel")}{" "}
                <code className="font-mono text-slate-700">
                  {isActive ? activeModel : provider.defaultModel}
                </code>
              </p>
              <p className="mt-2 text-sm tabular-nums text-slate-700">
                {providerUsage[provider.id] ?? 0}{" "}
                <span className="text-xs text-slate-400">{t("pages.providers.requestsLogged")}</span>
              </p>
              <div className="mt-3 flex flex-wrap gap-1">
                {provider.availableModels.map((model) => (
                  <code
                    key={model}
                    className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600"
                  >
                    {model}
                  </code>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">{t("pages.providers.fallbackChain")}</h2>
        <p className="mt-1 text-xs text-slate-500">
          {t("pages.providers.fallbackDescription")}
        </p>
        {fallbackChain.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">
            {t("pages.providers.noFallback")}
          </p>
        ) : (
          <ol className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            {fallbackChain.map((id, index) => (
              <li key={id} className="flex items-center gap-2">
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                  {id}
                </span>
                {index < fallbackChain.length - 1 && (
                  <span className="text-slate-400">→</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
