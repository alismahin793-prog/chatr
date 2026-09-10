"use client";

import { useAdminI18n } from "@/i18n/LanguageProvider";

interface SettingsIdentityProps {
  displayName: string | null;
  email: string | null | undefined;
  userIdPrefix: string;
  role: string;
  roleTone: "emerald" | "default";
  status: string;
  statusTone: "emerald" | "default";
  signedInSince: string;
}

export default function SettingsIdentity({
  displayName,
  email,
  userIdPrefix,
  role,
  roleTone,
  status,
  statusTone,
  signedInSince,
}: SettingsIdentityProps) {
  const { t } = useAdminI18n();

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">{t("pages.settings.yourIdentity")}</h2>
      <dl className="mt-4 space-y-3 text-sm">
        <Row label={t("common.name")} value={displayName ?? "—"} />
        <Row label={t("pages.settings.email")} value={email ?? "—"} />
        <Row label={t("pages.settings.userId")} value={`${userIdPrefix}…`} mono />
        <Row
          label={t("pages.settings.role")}
          value={role}
          tone={roleTone}
        />
        <Row
          label={t("common.status")}
          value={status}
          tone={statusTone}
        />
        <Row
          label={t("pages.settings.signedInSince")}
          value={signedInSince}
        />
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
