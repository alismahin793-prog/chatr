"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AdminNavItem } from "@/components/admin/nav";
import { adminNavItemForPath } from "@/components/admin/nav";
import { navDescriptionKey, navLabelKey } from "@/i18n/navKeys";
import { useAdminI18n } from "@/i18n/LanguageProvider";
import AdminIcon from "@/components/admin/AdminIcons";

export default function AdminNavLink({ item }: { item: AdminNavItem }) {
  const pathname = usePathname();
  const { t } = useAdminI18n();
  const active = adminNavItemForPath(pathname)?.href === item.href;
  const label = t(navLabelKey(item));
  const description = t(navDescriptionKey(item));

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={description}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-slate-800 text-white"
          : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-100"
      }`}
    >
      <AdminIcon name={item.icon} className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}