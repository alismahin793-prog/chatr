import Link from "next/link";
import type { GrantedGroup } from "@/server/admin/permissions";

interface AdminSidebarProps {
  groups: GrantedGroup[];
  adminName: string;
}

/**
 * Server-rendered sidebar for the Admin Panel. Only shows sections the admin
 * actually has permission for (least privilege) — an admin sees only the
 * groups for which they hold at least one permission.
 */
export default function AdminSidebar({ groups, adminName }: AdminSidebarProps) {
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-zinc-200 bg-white md:flex">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-4">
        <span className="grid size-8 place-items-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
          C
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-900">Admin Panel</p>
          <p className="truncate text-xs text-zinc-500">{adminName}</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        <Link
          href="/admin"
          className="mb-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
        >
          Dashboard
        </Link>
        <Link
          href="/admin/permissions"
          className="mb-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
        >
          Permissions
        </Link>
        <p className="mt-4 px-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Sections
        </p>
        {groups.length === 0 ? (
          <p className="px-3 py-2 text-sm text-zinc-400">No sections granted.</p>
        ) : (
          groups.map((group) => (
            <Link
              key={group.key}
              href={`/admin?section=${group.key.toLowerCase()}`}
              className="mb-0.5 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              {group.label}
            </Link>
          ))
        )}
      </nav>

      <div className="border-t border-zinc-200 p-3">
        <Link
          href="/chat"
          className="block rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100"
        >
          Back to Chat
        </Link>
      </div>
    </aside>
  );
}
