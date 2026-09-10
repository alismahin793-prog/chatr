"use client";

import Link from "next/link";
import { useAdminI18n } from "@/i18n/LanguageProvider";

/**
 * Localized entry link from the Admin dashboard into Cloud Development.
 * Client component so the label can react to the Admin language preference.
 */
export default function CloudConsoleLink() {
  const { t } = useAdminI18n();
  return (
    <Link
      href="/admin/cloud"
      className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:underline"
    >
      {t("dashboard.openCloud")} →
    </Link>
  );
}