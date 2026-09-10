"use client";

import { useAdminI18n } from "@/i18n/LanguageProvider";

export default function SettingsHelpfulLinks() {
  const { t } = useAdminI18n();

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">{t("pages.settings.helpfulLinks")}</h2>
      <ul className="mt-4 space-y-2 text-sm">
        <li>
          <a
            href="https://supabase.com/dashboard"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-indigo-600 hover:underline"
          >
            {t("pages.settings.supabaseDashboard")}
          </a>
        </li>
        <li>
          <a
            href="https://vercel.com/dashboard"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-indigo-600 hover:underline"
          >
            {t("pages.settings.vercelDashboard")}
          </a>
        </li>
      </ul>
      <p className="mt-4 text-xs text-slate-400">
        {t("pages.settings.envKeysNote")}
      </p>
    </section>
  );
}
