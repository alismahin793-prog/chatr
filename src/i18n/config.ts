/**
 * Admin i18n configuration. Project-native locale system for the Super Admin
 * console only — the user app (/chat) is intentionally untouched.
 *
 * Supported locales: en (ltr), ar (rtl).
 */
export type Locale = "en" | "ar";

export const SUPPORTED_LOCALES = ["en", "ar"] as const;

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_DIRECTION: Record<Locale, "ltr" | "rtl"> = {
  en: "ltr",
  ar: "rtl",
};

/** Client-side preference key used to persist the Admin language choice. */
export const ADMIN_LOCALE_STORAGE_KEY = "chatr.admin.locale";

export function isLocale(value: unknown): value is Locale {
  return SUPPORTED_LOCALES.some((locale) => locale === value);
}

/** 1) supported locales are en and ar (enforced at runtime too). */
export function normalizeLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** Direction lookup: en → ltr, ar → rtl, anything unknown → default (en → ltr). */
export function getDirection(locale: unknown): "ltr" | "rtl" {
  return LOCALE_DIRECTION[normalizeLocale(locale)];
}