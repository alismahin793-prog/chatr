import type { AdminNavItem } from "@/components/admin/nav";
import type { TranslationKey } from "@/i18n/translations/en";

/**
 * Maps the canonical English navigation labels from nav.ts (the single source
 * of truth that the UI tests assert against) to their translation keys.
 *
 * nav.ts intentionally keeps English label/description literals so
 * `tests/ui/admin-layout.test.ts` and `adminNavItemForPath` never drift; the
 * shell translates those literals at render time through this module.
 */
export const NAV_LABEL_KEYS: Record<string, TranslationKey> = {
  Dashboard: "nav.dashboard",
  "Registration Requests": "nav.requests",
  Users: "nav.users",
  "Test Users": "nav.testUsers",
  "AI & Usage": "nav.aiUsage",
  "AI Request Logs": "nav.aiLogs",
  "AI / Providers": "nav.providers",
  Features: "nav.features",
  Improvements: "nav.improvements",
  "Cloud Development": "nav.cloudDevelopment",
  Projects: "nav.cloudProjects",
  Deployments: "nav.cloudDeployments",
  Environments: "nav.cloudEnvironments",
  "Self Development": "nav.selfDevelopment",
  "Audit Logs": "nav.auditLogs",
  System: "nav.system",
  Settings: "nav.settings",
};

export const NAV_DESCRIPTION_KEYS: Record<string, TranslationKey> = {
  Dashboard: "navDesc.dashboard",
  "Registration Requests": "navDesc.requests",
  Users: "navDesc.users",
  "Test Users": "navDesc.testUsers",
  "AI & Usage": "navDesc.aiUsage",
  "AI Request Logs": "navDesc.aiLogs",
  "AI / Providers": "navDesc.providers",
  Features: "navDesc.features",
  Improvements: "navDesc.improvements",
  "Cloud Development": "navDesc.cloudDevelopment",
  Projects: "navDesc.cloudProjects",
  Deployments: "navDesc.cloudDeployments",
  Environments: "navDesc.cloudEnvironments",
  "Self Development": "navDesc.selfDevelopment",
  "Audit Logs": "navDesc.auditLogs",
  System: "navDesc.system",
  Settings: "navDesc.settings",
};

export function navLabelKey(item: Pick<AdminNavItem, "label">): TranslationKey {
  return NAV_LABEL_KEYS[item.label] ?? "groups.overview";
}

export function navDescriptionKey(item: Pick<AdminNavItem, "label">): TranslationKey {
  return NAV_DESCRIPTION_KEYS[item.label] ?? "groups.overview";
}