import { ADMIN_LOCALE_STORAGE_KEY, DEFAULT_LOCALE, normalizeLocale, type Locale } from "./config";

/**
 * Client-side persistence for the Admin language preference.
 *
 * Uses localStorage only — no database, no cookies, no auth changes. The
 * storage object is injected so the same module is unit-testable under node
 * and works trivially under a real browser / jsdom (defaults to
 * `globalThis.localStorage` when available).
 *
 * Unknown/invalid stored values safely fall back to English (DEFAULT_LOCALE).
 */

type StorageLike = Pick<Storage, "getItem">;
type WriterLike = Pick<Storage, "setItem">;

function defaultStorage(): Storage | null {
  try {
    return typeof globalThis !== "undefined" && "localStorage" in globalThis
      ? globalThis.localStorage
      : null;
  } catch {
    return null;
  }
}

export function readStoredLocale(storage?: StorageLike | null): Locale {
  const store = storage ?? defaultStorage();
  if (!store) return DEFAULT_LOCALE;
  try {
    return normalizeLocale(store.getItem(ADMIN_LOCALE_STORAGE_KEY));
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function storeLocale(locale: Locale, storage?: WriterLike | null): void {
  const store = storage ?? defaultStorage();
  if (!store) return;
  try {
    store.setItem(ADMIN_LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage can be unavailable (private mode / quota). Preference is
    // best-effort only — the session keeps working either way.
  }
}