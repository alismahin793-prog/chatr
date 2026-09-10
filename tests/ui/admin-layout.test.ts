import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ADMIN_NAV,
  ADMIN_NAV_GROUPS,
  adminNavItemForPath,
  type AdminNavItem,
} from "@/components/admin/nav";

const ROOT = process.cwd();

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf8");
}

const ADMIN_PAGES = [
  "page.tsx",
  "requests/page.tsx",
  "users/page.tsx",
  "test-users/page.tsx",
  "features/page.tsx",
  "improvements/page.tsx",
  "ai/page.tsx",
  "ai/logs/page.tsx",
  "providers/page.tsx",
  "audit/page.tsx",
  "system/page.tsx",
  "settings/page.tsx",
  "cloud/page.tsx",
  "cloud/projects/page.tsx",
  "cloud/projects/[id]/page.tsx",
  "cloud/projects/[id]/files/page.tsx",
  "cloud/projects/[id]/terminal/page.tsx",
  "cloud/projects/[id]/git/page.tsx",
  "cloud/projects/[id]/pipeline/page.tsx",
  "cloud/projects/[id]/snapshots/page.tsx",
  "cloud/projects/[id]/deployments/page.tsx",
  "cloud/projects/[id]/environments/page.tsx",
  "cloud/deployments/page.tsx",
  "cloud/environments/page.tsx",
  "cloud/self-development/page.tsx",
  "cloud/self-development/new/page.tsx",
  "cloud/self-development/[id]/page.tsx",
];

/** Pages that render AdminSection directly (managers own their own header). */
const ADMIN_SECTION_PAGES = [
  "page.tsx",
  "requests/page.tsx",
  "users/page.tsx",
  "ai/page.tsx",
  "ai/logs/page.tsx",
  "providers/page.tsx",
  "system/page.tsx",
  "settings/page.tsx",
  "cloud/page.tsx",
  "cloud/deployments/page.tsx",
  "cloud/environments/page.tsx",
];

/** Client managers that render the console header inside themselves. */
const ADMIN_MANAGERS = [
  "AccountsManager.tsx",
  "AuditLogViewer.tsx",
  "TestUsersManager.tsx",
  "FeaturesManager.tsx",
  "ImprovementsManager.tsx",
  "cloud/CloudProjectsManager.tsx",
  "cloud/selfdevelopment/SelfDevelopmentDashboard.tsx",
  "cloud/selfdevelopment/SelfDevelopmentNewRequest.tsx",
  "cloud/selfdevelopment/SelfDevelopmentDetail.tsx",
];

describe("Admin vs Chat layout separation", () => {
  it("the chat page mounts the chat workspace and never the admin shell", () => {
    const chatPage = read("src/app/chat/page.tsx");
    expect(chatPage).toContain("ChatWorkspace");
    expect(chatPage).not.toMatch(/AdminLayout|AdminSidebar|requireAdminIdentity/);
  });

  it("the admin panel layout uses the Admin shell and enforces the guard server-side", () => {
    const adminLayout = read("src/app/admin/(panel)/layout.tsx");
    expect(adminLayout).toContain("AdminLayout");
    expect(adminLayout).toContain("requireAdminIdentity()");
    expect(adminLayout).toContain("adminGuardRedirectPath");
    expect(adminLayout).not.toMatch(/ChatWorkspace|@\/components\/chat/);
  });

  it("the Admin shell has its own chrome and never touches chat components", () => {
    const shell = read("src/components/admin/AdminLayout.tsx");
    expect(shell).toContain("AdminSidebar");
    expect(shell).toContain("AdminHeader");
    expect(shell).toContain("bg-slate-100");
    expect(shell).not.toContain("ChatWorkspace");
    expect(shell).not.toMatch(/@\/components\/chat\b/);

    const sidebar = read("src/components/admin/AdminSidebar.tsx");
    expect(sidebar).toContain("bg-slate-950");
    expect(sidebar).not.toContain("ChatWorkspace");
  });

  it("the root layout stays generic (no admin or chat chrome)", () => {
    const root = read("src/app/layout.tsx");
    expect(root).not.toMatch(/AdminSidebar|AdminLayout|ChatWorkspace/);
  });

  it("every admin page mounts the same console shell and the server guard", () => {
    for (const page of ADMIN_PAGES) {
      const source = read(`src/app/admin/(panel)/${page}`);
      expect(source).toContain("requireAdminIdentity");
    }
    for (const page of ADMIN_SECTION_PAGES) {
      const source = read(`src/app/admin/(panel)/${page}`);
      expect(/\bAdminSection\b/.test(source)).toBe(true);
    }
    for (const manager of ADMIN_MANAGERS) {
      expect(read(`src/components/admin/${manager}`)).toContain("AdminSection");
    }
  });
});

describe("Admin navigation model", () => {
  const required: [string, string][] = [
    ["Dashboard", "/admin"],
    ["Registration Requests", "/admin/requests"],
    ["Users", "/admin/users"],
    ["Test Users", "/admin/test-users"],
    ["AI & Usage", "/admin/ai"],
    ["AI Request Logs", "/admin/ai/logs"],
    ["AI / Providers", "/admin/providers"],
    ["Features", "/admin/features"],
    ["Improvements", "/admin/improvements"],
    ["Cloud Development", "/admin/cloud"],
    ["Projects", "/admin/cloud/projects"],
    ["Deployments", "/admin/cloud/deployments"],
    ["Environments", "/admin/cloud/environments"],
    ["Self Development", "/admin/cloud/self-development"],
    ["Audit Logs", "/admin/audit"],
    ["System", "/admin/system"],
    ["Settings", "/admin/settings"],
  ];

  it("contains every required console section at its canonical path", () => {
    const lookup = new Map<string, AdminNavItem>(ADMIN_NAV.map((item) => [item.label, item]));
    for (const [label, href] of required) {
      expect(lookup.get(label)?.href, `missing nav item ${label}`).toBe(href);
    }
  });

  it("only links inside the admin console", () => {
    for (const item of ADMIN_NAV) {
      expect(item.href.startsWith("/admin")).toBe(true);
    }
  });

  it("groups match the sidebar group headings", () => {
    expect(ADMIN_NAV_GROUPS).toEqual(["Overview", "People", "Platform", "Cloud", "System"]);
    for (const group of ADMIN_NAV_GROUPS) {
      expect(ADMIN_NAV.some((item) => item.group === group)).toBe(true);
    }
  });

  it("resolves active items including nested routes", () => {
    expect(adminNavItemForPath("/admin")?.href).toBe("/admin");
    expect(adminNavItemForPath("/admin/requests")?.href).toBe("/admin/requests");
    expect(adminNavItemForPath("/admin/ai")?.href).toBe("/admin/ai");
    expect(adminNavItemForPath("/admin/ai/logs")?.href).toBe("/admin/ai/logs");
    expect(adminNavItemForPath("/admin/cloud")?.href).toBe("/admin/cloud");
    expect(adminNavItemForPath("/admin/cloud/projects")?.href).toBe("/admin/cloud/projects");
    expect(adminNavItemForPath("/admin/cloud/projects/abc/files")?.href).toBe("/admin/cloud/projects");
    expect(adminNavItemForPath("/chat")).toBeUndefined();
  });
});

describe("Server-side authorization is preserved", () => {
  it("non-admins are redirected to the denied screen and anonymous users to login", async () => {
    const { adminGuardRedirectPath } = await import("@/server/admin/security");
    const { ForbiddenError, UnauthorizedError } = await import("@/server/errors");
    expect(adminGuardRedirectPath(new ForbiddenError())).toBe("/admin/denied");
    expect(adminGuardRedirectPath(new UnauthorizedError())).toBe("/login");
  });

  it("the /admin/users page is a Users directory, not the test-user screen", () => {
    const usersPage = read("src/app/admin/(panel)/users/page.tsx");
    expect(usersPage).toContain("listAllAccounts");
    expect(usersPage).not.toContain("TestUsersManager");
  });

  it("test users moved to their own route", () => {
    const testUsersPage = read("src/app/admin/(panel)/test-users/page.tsx");
    expect(testUsersPage).toContain("TestUsersManager");
  });
});