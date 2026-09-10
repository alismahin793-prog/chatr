// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminLanguageProvider, useAdminI18n } from "@/i18n/LanguageProvider";
import {
  ADMIN_LOCALE_STORAGE_KEY,
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  getDirection,
  isLocale,
  normalizeLocale,
} from "@/i18n/config";
import { translate } from "@/i18n/translate";
import { readStoredLocale, storeLocale } from "@/i18n/storage";
import { en } from "@/i18n/translations/en";
import { ar } from "@/i18n/translations/ar";
import type { TranslationKey } from "@/i18n/translations/en";
import { NAV_DESCRIPTION_KEYS, NAV_LABEL_KEYS } from "@/i18n/navKeys";

function Probe() {
  const { locale, dir, t, setLocale } = useAdminI18n();
  return (
    <div data-testid="probe">
      <span data-testid="locale">{locale}</span>
      <span data-testid="dir">{dir}</span>
      <span>{t("shell.superAdmin")}</span>
      <span>{t("dashboard.title")}</span>
      <button onClick={() => setLocale("ar")}>to-ar</button>
      <button onClick={() => setLocale("en")}>to-en</button>
    </div>
  );
}

const dirWrapper = () => document.querySelector("[dir]") as HTMLElement | null;

describe("i18n configuration", () => {
  it("supports exactly en and ar", () => {
    expect(SUPPORTED_LOCALES).toEqual(["en", "ar"]);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ar")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });

  it("maps en → ltr and ar → rtl", () => {
    expect(getDirection("en")).toBe("ltr");
    expect(getDirection("ar")).toBe("rtl");
  });

  it("falls back to English for unknown locales", () => {
    expect(normalizeLocale("fr")).toBe("en");
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale(null)).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale("ar")).toBe("ar");
    expect(getDirection("fr")).toBe("ltr");
  });
});

describe("translation lookup", () => {
  it("returns English values for en and Arabic values for ar", () => {
    expect(translate("en", "shell.superAdmin")).toBe("Super Admin");
    expect(translate("ar", "shell.superAdmin")).toBe("مدير النظام");
    expect(translate("ar", "dashboard.title")).toBe("لوحة التحكم");
  });

  it("covers every English key with an Arabic value (no missing translations)", () => {
    const enKeys = Object.keys(en).sort();
    const arKeys = Object.keys(ar).sort();
    expect(arKeys).toEqual(enKeys);
  });

  it("never leaves an empty string in either language", () => {
    for (const value of Object.values(en)) {
      expect(value.trim()).not.toBe("");
    }
    for (const value of Object.values(ar)) {
      expect(value.trim()).not.toBe("");
    }
  });
});

describe("module dictionaries", () => {
  const samples: [TranslationKey, string, string][] = [
    ["people.accounts.title", "Accounts", "الحسابات"],
    ["people.testUsers.description", "Temporary throwaway accounts for manual testing. All writes require a fresh elevated (re-auth) window.", "حسابات مؤقتة تُستخدم للاختبار اليدوي فقط. كل عمليات الكتابة تتطلب نافذة صلاحية حديثة (إعادة مصادقة)."],
    ["platform.features.enabled", "Enabled", "مفعّلة"],
    ["platform.improvements.statusImplemented", "Implemented", "مُنفَّذ"],
    ["platform.audit.title", "Audit Logs", "سجلات التدقيق"],
    ["cloud.projects.title", "Projects", "المشاريع"],
    ["cloud.projects.countMany", "{count} projects", "{count} مشاريع"],
    ["cloud.deployments.rollback", "Rollback", "التراجع"],
    ["cloud.files.deleteTitle", "Delete", "حذف"],
    ["cloud.git.pull", "Pull", "سحب"],
    ["cloud.terminal.command", "Command", "الأمر"],
    ["cloud.snapshots.restore", "Restore", "استعادة"],
    ["cloud.pipeline.step.gate", "Gate", "بوابة"],
    ["cloud.status.rolledBack", "Rolled back", "تم التراجع"],
    ["selfdev.dashboard.description", "AI-planned code changes inside a cloud workspace, gated by Super Admin approval at every step.", "تغييرات برمجية يخطّط لها الذكاء الاصطناعي داخل بيئة سحابية، وتخضع لموافقة مدير النظام في كل خطوة."],
    ["selfdev.status.awaiting_plan_approval", "Awaiting plan approval", "بانتظار موافقة الخطة"],
    ["selfdev.actions.buttonApproveDeploy", "Approve deployment", "الموافقة على النشر"],
    ["selfdev.reviewResult.needs_changes", "Needs changes", "يحتاج تغييرات"],
    ["dashboard.totalUsers", "Total users", "إجمالي المستخدمين"],
    ["reauth.failed", "Incorrect password. Try again.", "كلمة المرور غير صحيحة. حاول مجددًا."],
    ["denied.title", "Access denied", "الوصول مرفوض"],
    ["pages.cloud.hub.cardProjects", "Projects", "المشاريع"],
    ["pages.cloud.hub.cardPipelineDescription", "Static, declarative steps: {steps}.", "خطوات ثابتة وتصريحية: {steps}."],
  ];

  it.each(samples)("translates %s into both languages", (key, enWanted, arWanted) => {
    expect(translate("en", key)).toBe(enWanted);
    expect(translate("ar", key)).toBe(arWanted);
  });

  it("interpolates {param}s in Arabic and English alike", () => {
    expect(translate("en", "cloud.projects.countMany", { count: 3 })).toBe("3 projects");
    expect(translate("ar", "cloud.projects.countMany", { count: 3 })).toBe("3 مشاريع");
    expect(translate("en", "cloud.files.deleteTarget", { path: "a/b.txt" })).toBe("Delete a/b.txt");
    expect(translate("ar", "cloud.files.deleteTarget", { path: "a/b.txt" })).toBe("حذف a/b.txt");
    expect(translate("en", "selfdev.detail.actionCompleted", { title: "Approve plan" })).toBe(
      "Approve plan completed."
    );
    expect(translate("en", "cloud.deployments.rollbackIssued", { from: "A", to: "B", ref: "r" })).toBe(
      "Rollback issued: A → B (r)"
    );
  });

  it("covers every navigation label and description", () => {
    for (const key of Object.values(NAV_LABEL_KEYS)) {
      expect(en[key]).toBeTruthy();
      expect(ar[key]).toBeTruthy();
    }
    for (const key of Object.values(NAV_DESCRIPTION_KEYS)) {
      expect(en[key]).toBeTruthy();
      expect(ar[key]).toBeTruthy();
    }
  });

  it("maps every canonical nav label through navKeys without losing the English label", () => {
    for (const [label, key] of Object.entries(NAV_LABEL_KEYS)) {
      expect(en[key]).toBe(label);
    }
  });
});

describe("locale persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to English when nothing is stored", () => {
    expect(readStoredLocale()).toBe("en");
  });

  it("reads a stored valid locale", () => {
    window.localStorage.setItem(ADMIN_LOCALE_STORAGE_KEY, "ar");
    expect(readStoredLocale()).toBe("ar");
  });

  it("falls back to English for an invalid stored value", () => {
    window.localStorage.setItem(ADMIN_LOCALE_STORAGE_KEY, "fr");
    expect(readStoredLocale()).toBe("en");
  });

  it("stores the selected locale under the admin key", () => {
    storeLocale("ar");
    expect(window.localStorage.getItem(ADMIN_LOCALE_STORAGE_KEY)).toBe("ar");
  });
});

describe("AdminLanguageProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders ltr and English by default", () => {
    render(
      <AdminLanguageProvider>
        <Probe />
      </AdminLanguageProvider>
    );
    expect(dirWrapper()?.dir).toBe("ltr");
    expect(dirWrapper()?.lang).toBe("en");
    expect(screen.getByText("Super Admin")).toBeTruthy();
    expect(screen.getByText("Dashboard")).toBeTruthy();
  });

  it("switches to rtl + Arabic and persists the choice", async () => {
    render(
      <AdminLanguageProvider>
        <Probe />
      </AdminLanguageProvider>
    );
    fireEvent.click(screen.getByText("to-ar"));
    await waitFor(() => expect(dirWrapper()?.dir).toBe("rtl"));
    await waitFor(() => expect(dirWrapper()?.lang).toBe("ar"));
    expect(screen.getByText("مدير النظام")).toBeTruthy();
    expect(screen.getByText("لوحة التحكم")).toBeTruthy();
    expect(window.localStorage.getItem(ADMIN_LOCALE_STORAGE_KEY)).toBe("ar");
  });

  it("restores a stored Arabic preference on a fresh mount", async () => {
    render(
      <AdminLanguageProvider>
        <Probe />
      </AdminLanguageProvider>
    );
    fireEvent.click(screen.getByText("to-ar"));
    await waitFor(() => expect(dirWrapper()?.dir).toBe("rtl"));

    window.localStorage.clear();
    window.localStorage.setItem(ADMIN_LOCALE_STORAGE_KEY, "ar");
    render(
      <AdminLanguageProvider>
        <Probe />
      </AdminLanguageProvider>
    );
    await waitFor(() => expect(dirWrapper()?.dir).toBe("rtl"));
    expect(screen.getAllByText("مدير النظام").length).toBeGreaterThan(1);
  });

  it("ignores an invalid stored value and renders English", async () => {
    window.localStorage.setItem(ADMIN_LOCALE_STORAGE_KEY, "fr");
    render(
      <AdminLanguageProvider>
        <Probe />
      </AdminLanguageProvider>
    );
    await waitFor(() => expect(dirWrapper()?.dir).toBe("ltr"));
    expect(screen.getByText("Super Admin")).toBeTruthy();
  });

  it("supports switching back to English", async () => {
    render(
      <AdminLanguageProvider>
        <Probe />
      </AdminLanguageProvider>
    );
    fireEvent.click(screen.getByText("to-ar"));
    await waitFor(() => expect(dirWrapper()?.dir).toBe("rtl"));
    fireEvent.click(screen.getByText("to-en"));
    await waitFor(() => expect(dirWrapper()?.dir).toBe("ltr"));
    expect(screen.getByText("Super Admin")).toBeTruthy();
  });
});