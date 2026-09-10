import { DEFAULT_LOCALE, type Locale } from "./config";
import { en, type TranslationKey, type TranslationParams } from "./translations/en";
import { ar } from "./translations/ar";

/**
 * Pure translation lookup. Server-safe (no DOM), dependency-free.
 *
 * Lookup order:
 *   current locale value → English fallback → the key itself.
 * Unknown keys resolve to the key so a missing string is visible but never
 * crashes the console.
 */
export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: TranslationParams
): string {
  const dict = locale === "ar" ? ar : en;
  let text: string | undefined = dict[key];
  if (text === undefined) text = en[key];
  if (text === undefined) text = key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${name}\\}`, "g"), String(value));
    }
  }
  return text;
}

/** Natural-language label for a locale (used by the language switcher). */
export function localeLabel(locale: Locale, inLocale?: Locale): string {
  if (locale === "ar") return inLocale === "en" ? "Arabic" : "العربية";
  if (locale === "en") return inLocale === "ar" ? "الإنجليزية" : "English";
  return DEFAULT_LOCALE;
}