"use client";

import Link from "next/link";
import {
  ADMIN_NAV_GROUPS,
  ADMIN_NAV,
  type AdminNavGroup,
} from "@/components/admin/nav";
import AdminNavLink from "@/components/admin/AdminNavLink";
import { useAdminI18n } from "@/i18n/LanguageProvider";
import type { TranslationKey } from "@/i18n/translations/en";

interface AdminSidebarProps {
  adminName: string;
  adminEmail: string;
}

const GROUP_TITLE_KEYS: Record<AdminNavGroup, TranslationKey> = {
  Overview: "groups.overview",
  People: "groups.people",
  Platform: "groups.platform",
  Cloud: "groups.cloud",
  System: "groups.system",
};

/**
 * Sidebar for the Admin Console. Every section is rendered to a single
 * privileged role (super_admin); the server layout independently enforces
 * authorization on each page — this list is navigation, never access control.
 * The theme (dark slate) intentionally shares nothing with the chat client so
 * the two consoles read as separate applications.
 *
 * Labels are translated through <AdminLanguageProvider>; direction handling is
 * delegated to the provider's root wrapper so this component uses logical
 * utilities (start/border-e/text-start) that flip under rtl.
 */
export default function AdminSidebar({ adminName, adminEmail }: AdminSidebarProps) {
  const { t } = useAdminI18n();

  return (
    <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 flex-col border-e border-slate-800 bg-slate-950 lg:flex">
      <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 text-sm font-bold text-white shadow-lg shadow-indigo-900/40">
          CC
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-white">
            {t("shell.consoleTitle")}
          </p>
          <p className="truncate text-[11px] uppercase tracking-wider text-slate-500">
            {t("shell.superAdmin")}
          </p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {ADMIN_NAV_GROUPS.map((group) => (
          <div key={group} className="mb-5">
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
              {t(GROUP_TITLE_KEYS[group])}
            </p>
            <div className="space-y-0.5">
              {ADMIN_NAV.filter((item) => item.group === group).map((item) => (
                <AdminNavLink key={item.href} item={item} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-800 p-3">
        <Link
          href="/chat"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800/50 hover:text-slate-100"
        >
          <ExternalIcon />
          <span>{t("shell.openUserApp")}</span>
        </Link>
        <form action="/auth/logout" method="post">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start text-sm font-medium text-slate-400 transition-colors hover:bg-red-950/40 hover:text-red-300"
          >
            <SignOutIcon />
            <span>{t("shell.signOut")}</span>
          </button>
        </form>
        <p className="mt-2 truncate px-3 text-[11px] text-slate-600" title={adminEmail}>
          {adminName}
        </p>
      </div>
    </aside>
  );
}

function ExternalIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4 shrink-0"
      aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4 shrink-0"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}