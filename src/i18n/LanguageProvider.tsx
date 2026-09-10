"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { DEFAULT_LOCALE, getDirection, normalizeLocale, type Locale } from "./config";
import { readStoredLocale, storeLocale } from "./storage";
import { translate } from "./translate";
import type { TranslationKey, TranslationParams } from "./translations/en";

interface AdminI18nValue {
  locale: Locale;
  dir: "ltr" | "rtl";
  setLocale: (locale: Locale | string) => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
}

const AdminI18nContext = createContext<AdminI18nValue | null>(null);

/**
 * Tiny reactive adapter over localStorage so the provider can read the saved
 * preference with useSyncExternalStore — no setState-in-effect, no hydration
 * mismatch. Renders default to English on the server; after hydration the
 * stored value is applied synchronously by React's external-store mechanism.
 */
const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Scoped i18n provider for the Super Admin console.
 *
 * - Renders a single `dir`/`lang` wrapper at the Admin root — direction is
 *   applied once here, not duplicated across components.
 * - Persists the choice to localStorage; refreshes keep the selected locale.
 * - Defaults to English when nothing is stored or the stored value is invalid.
 * - setLocale is an event handler (not an effect) that writes storage and
 *   notifies subscribers, so the UI reacts immediately.
 */
export function AdminLanguageProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore(
    subscribe,
    () => readStoredLocale(),
    () => DEFAULT_LOCALE
  );

  const setLocale = useCallback((next: Locale | string) => {
    const normalized = normalizeLocale(next);
    storeLocale(normalized);
    notifyListeners();
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) => translate(locale, key, params),
    [locale]
  );

  const dir = getDirection(locale);

  /**
   * Mirror the Admin locale onto the document element so the browser applies
   * the matching direction (scrollbars, default form styling, screen readers).
   * Pure DOM write — no state, safe under React Compiler lint rules.
   */
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  const value = useMemo<AdminI18nValue>(
    () => ({ locale, dir, setLocale, t }),
    [locale, dir, setLocale, t]
  );

  return (
    <AdminI18nContext.Provider value={value}>
      <div dir={dir} lang={locale}>
        {children}
      </div>
    </AdminI18nContext.Provider>
  );
}

export function useAdminI18n(): AdminI18nValue {
  const value = useContext(AdminI18nContext);
  if (!value) {
    throw new Error("useAdminI18n must be used within <AdminLanguageProvider>.");
  }
  return value;
}