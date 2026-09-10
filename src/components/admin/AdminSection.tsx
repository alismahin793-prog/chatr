"use client";

import type { ReactNode } from "react";
import { useAdminI18n } from "@/i18n/LanguageProvider";
import type { TranslationKey } from "@/i18n/translations/en";

interface AdminSectionProps {
  /** Raw title text — used when titleKey is not provided (legacy behavior). */
  title?: string;
  /** Raw description text — used when descriptionKey is not provided. */
  description?: string;
  /** i18n key for the title (takes precedence over title). */
  titleKey?: TranslationKey;
  /** i18n key for the description (takes precedence over description). */
  descriptionKey?: TranslationKey;
  children?: ReactNode;
}

/**
 * Standard page header + body container for the Admin Console. Plain
 * presentational component usable from both server pages and client managers.
 *
 * Pages that have been translated pass titleKey/descriptionKey; pages that
 * have not yet been converted keep passing raw title/description strings, so
 * conversion is optional and gradual.
 */
export default function AdminSection({
  title,
  description,
  titleKey,
  descriptionKey,
  children,
}: AdminSectionProps) {
  const { t } = useAdminI18n();
  const resolvedTitle = titleKey ? t(titleKey) : (title ?? "");
  const resolvedDescription = descriptionKey ? t(descriptionKey) : (description ?? "");

  return (
    <div className="mx-auto w-full max-w-6xl">
      <header className="border-b border-slate-200 pb-4">
        <p className="text-xl font-semibold tracking-tight text-slate-900">{resolvedTitle}</p>
        <p className="mt-1 text-sm text-slate-500">{resolvedDescription}</p>
      </header>
      {children ? <div className="mt-6">{children}</div> : null}
    </div>
  );
}