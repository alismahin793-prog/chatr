/**
 * Shared Admin navigation model. The sidebar, the top header and the UI tests
 * all read from this single source of truth so the Admin Console never drifts
 * from the user app.
 *
 * This module is dependency-free and usable from server components, client
 * components and vitest alike.
 */
export type AdminNavGroup = "Overview" | "People" | "Platform" | "Cloud" | "System";

export type AdminIconName =
  | "dashboard"
  | "inbox"
  | "users"
  | "flask"
  | "chart"
  | "activity"
  | "sparkles"
  | "toggle"
  | "bulb"
  | "shield"
  | "server"
  | "gear"
  | "cloud"
  | "folder"
  | "terminal"
  | "git"
  | "rocket"
  | "layers"
  | "wand";

export interface AdminNavItem {
  label: string;
  href: string;
  group: AdminNavGroup;
  icon: AdminIconName;
  description: string;
}

/** Ordered navigation groups (group -> items). */
export const ADMIN_NAV: readonly AdminNavItem[] = [
  {
    label: "Dashboard",
    href: "/admin",
    group: "Overview",
    icon: "dashboard",
    description: "Platform health and usage at a glance.",
  },
  {
    label: "Registration Requests",
    href: "/admin/requests",
    group: "People",
    icon: "inbox",
    description: "Review sign-ups and manage account access.",
  },
  {
    label: "Users",
    href: "/admin/users",
    group: "People",
    icon: "users",
    description: "Every account with its role and lifecycle status.",
  },
  {
    label: "Test Users",
    href: "/admin/test-users",
    group: "People",
    icon: "flask",
    description: "Temporary throwaway accounts for manual testing.",
  },
  {
    label: "AI & Usage",
    href: "/admin/ai",
    group: "Platform",
    icon: "chart",
    description: "Model usage across providers and time.",
  },
  {
    label: "AI Request Logs",
    href: "/admin/ai/logs",
    group: "Platform",
    icon: "activity",
    description: "Every AI request that hit a provider.",
  },
  {
    label: "AI / Providers",
    href: "/admin/providers",
    group: "Platform",
    icon: "sparkles",
    description: "Configured AI providers and their fallback order.",
  },
  {
    label: "Features",
    href: "/admin/features",
    group: "Platform",
    icon: "toggle",
    description: "Registry of app capabilities toggled server-side.",
  },
  {
    label: "Improvements",
    href: "/admin/improvements",
    group: "Platform",
    icon: "bulb",
    description: "User-submitted ideas and their acceptance state.",
  },
  {
    label: "Cloud Development",
    href: "/admin/cloud",
    group: "Cloud",
    icon: "cloud",
    description: "Super-admin development: projects, files, terminal, git, pipeline.",
  },
  {
    label: "Projects",
    href: "/admin/cloud/projects",
    group: "Cloud",
    icon: "folder",
    description: "Workspaces, repositories and activity for cloud projects.",
  },
  {
    label: "Deployments",
    href: "/admin/cloud/deployments",
    group: "Cloud",
    icon: "rocket",
    description: "Production and preview deployments across cloud projects.",
  },
  {
    label: "Environments",
    href: "/admin/cloud/environments",
    group: "Cloud",
    icon: "layers",
    description: "Environment variable metadata per cloud project.",
  },
  {
    label: "Self Development",
    href: "/admin/cloud/self-development",
    group: "Cloud",
    icon: "wand",
    description: "AI-planned code changes inside a cloud workspace, gated by Super Admin approval at every step.",
  },
  {
    label: "Audit Logs",
    href: "/admin/audit",
    group: "System",
    icon: "shield",
    description: "Immutable trail of sensitive admin actions.",
  },
  {
    label: "System",
    href: "/admin/system",
    group: "System",
    icon: "server",
    description: "Runtime health and database connectivity.",
  },
  {
    label: "Settings",
    href: "/admin/settings",
    group: "System",
    icon: "gear",
    description: "Roles, statuses and deployment information.",
  },
] as const;

/** Items grouped in sidebar display order. */
export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  "Overview",
  "People",
  "Platform",
  "Cloud",
  "System",
];

/** Given a pathname, returns the nav item that should render as active. */
export function adminNavItemForPath(
  pathname: string
): AdminNavItem | undefined {
  const exact = ADMIN_NAV.find((item) => item.href === pathname);
  if (exact) return exact;
  const prefixMatches = ADMIN_NAV.filter(
    (item) => item.href !== "/admin" && pathname.startsWith(`${item.href}/`)
  );
  // Most specific route wins (e.g. /admin/ai/logs → "AI Request Logs").
  return prefixMatches.sort((a, b) => b.href.length - a.href.length)[0];
}