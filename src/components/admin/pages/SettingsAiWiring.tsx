"use client";

import { useAdminI18n } from "@/i18n/LanguageProvider";

interface SettingsAiWiringProps {
  activeProvider: string;
  activeModel: string;
  configuredCount: number;
  databaseOk: boolean;
  platformValue: string;
  runtimeVersion: string;
}

export default function SettingsAiWiring({
  activeProvider,
  activeModel,
  configuredCount,
  databaseOk,
  platformValue,
  runtimeVersion,
}: SettingsAiWiringProps) {
  const { t } = useAdminI18n();

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">{t("pages.settings.aiWiring")}</h2>
      <dl className="mt-4 space-y-3 text-sm">
        <Row label={t("pages.settings.activeProvider")} value={activeProvider} mono />
        <Row label={t("pages.settings.activeModel")} value={activeModel} mono />
        <Row label={t("pages.settings.configuredProviders")} value={`${configuredCount} (no keys shown)`} />
        <Row
          label={t("pages.system.database")}
          value={databaseOk ? t("pages.system.connected") : t("pages.system.unreachable")}
          tone={databaseOk ? "emerald" : "red"}
        />
        <Row label={t("pages.settings.platform")} value={platformValue} />
        <Row label={t("pages.settings.runtime")} value={runtimeVersion} />
      </dl>
    </section>
  );
}

function Row({
  label,
  value,
  mono = false,
  tone = "default",
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "default" | "emerald" | "red";
}) {
  const color =
    tone === "emerald" ? "text-emerald-700" : tone === "red" ? "text-red-700" : "text-slate-900";
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd
        className={`text-end font-medium ${color} ${mono ? "font-mono text-xs leading-5" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
