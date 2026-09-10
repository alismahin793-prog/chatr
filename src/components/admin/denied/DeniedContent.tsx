"use client";

import Link from "next/link";
import { useAdminI18n } from "@/i18n/LanguageProvider";

export default function DeniedContent() {
  const { t } = useAdminI18n();

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-red-50 text-lg font-bold text-red-600 ring-1 ring-red-200">
          403
        </span>
        <h1 className="mt-6 text-2xl font-semibold text-zinc-900">{t("denied.title")}</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-500">{t("denied.intro")}</p>
        <div className="mt-8">
          <Link
            href="/chat"
            className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
          >
            {t("denied.cta")}
          </Link>
        </div>
      </div>
    </main>
  );
}