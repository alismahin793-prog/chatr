"use client";

import { usePathname } from "next/navigation";
import { adminNavItemForPath } from "@/components/admin/nav";
import { navLabelKey } from "@/i18n/navKeys";
import { useAdminI18n } from "@/i18n/LanguageProvider";
import type { Locale } from "@/i18n/config";

interface AdminHeaderProps {
  adminName: string;
  adminEmail: string;
}

/**
 * Top bar for the Admin Console. Displays the current section derived from the
 * active route, the signed-in identity, and the language switcher (EN / العربية).
 * Pure chrome — auth lives in the server layout.
 */
export default function AdminHeader({ adminName, adminEmail }: AdminHeaderProps) {
  const pathname = usePathname();
  const { locale, setLocale, t } = useAdminI18n();
  const section = adminNavItemForPath(pathname);
  const sectionLabel = section ? t(navLabelKey(section)) : t("groups.overview");
  const initials = (adminName.trim() || adminEmail || "A")
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="flex h-16 items-center gap-4 px-4 sm:px-6 lg:px-8">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {t("shell.adminConsole")}
          </p>
          <h1 className="truncate text-sm font-semibold text-slate-900">
            {sectionLabel}
          </h1>
        </div>

        <div
          role="group"
          aria-label={t("language.switch")}
          className="flex shrink-0 items-center overflow-hidden rounded-lg border border-slate-200"
        >
          <LocaleButton
            active={locale === "en"}
            locale="en"
            label="EN"
            title={t("language.english")}
            onSelect={setLocale}
          />
          <LocaleButton
            active={locale === "ar"}
            locale="ar"
            label="العربية"
            title={t("language.arabic")}
            onSelect={setLocale}
          />
        </div>

        <span className="hidden rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-white sm:inline-flex">
          {t("shell.production")}
        </span>

        <div className="hidden items-center gap-2 sm:flex">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white">
            {initials}
          </span>
          <div className="min-w-0 max-w-40">
            <p className="truncate text-sm font-medium text-slate-900">{adminName}</p>
            <p className="truncate text-[11px] text-slate-400">{adminEmail}</p>
          </div>
        </div>
      </div>
    </header>
  );
}

function LocaleButton({
  active,
  locale,
  label,
  title,
  onSelect,
}: {
  active: boolean;
  locale: Locale;
  label: string;
  title: string;
  onSelect: (locale: Locale) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={() => onSelect(locale)}
      className={
        active
          ? "bg-slate-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-white transition-colors"
          : "bg-transparent px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 transition-colors hover:text-slate-900"
      }
    >
      {label}
    </button>
  );
}