"use client";

import { useAdminI18n } from "@/i18n/LanguageProvider";

interface SettingsRolesProps {
  rolesValue: string;
}

export default function SettingsRoles({ rolesValue }: SettingsRolesProps) {
  const { t } = useAdminI18n();

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">{t("pages.settings.rolesAndStatuses")}</h2>
      <p className="mt-1 text-xs text-slate-500">
        {t("pages.settings.rolesAndStatusesDescription")}
      </p>
      <dl className="mt-4 space-y-3 text-sm">
        <Row
          label={t("pages.settings.roles")}
          value={rolesValue}
        />
        <Row
          label={t("pages.settings.lifecycle")}
          value={t("pages.settings.lifecycleValue")}
        />
        <Row label={t("pages.settings.ownerProtection")} value={t("pages.settings.ownerProtectionValue")} />
      </dl>
    </section>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-end font-medium text-slate-900">
        {value}
      </dd>
    </div>
  );
}
