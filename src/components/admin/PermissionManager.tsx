"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ReauthModal from "@/components/admin/ReauthModal";

export interface PermissionUser {
  id: string;
  name: string;
  email: string;
  permissions: string[];
}

export interface PermissionGroup {
  key: string;
  label: string;
  permissions: string[];
}

interface PermissionManagerProps {
  users: PermissionUser[];
  groups: PermissionGroup[];
  sensitivePermissions: string[];
}

type PendingAction = {
  userId: string;
  permission: string;
  grant: boolean;
} | null;

/**
 * Client-side permission management UI for the Admin Panel. Sensitive grants
 * (any permission in SENSITIVE_PERMISSIONS) trigger a 30-second re-auth modal
 * before the action is sent to the server.
 */
export function PermissionManager({
  users,
  groups,
  sensitivePermissions,
}: PermissionManagerProps) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingAction>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit({ userId, permission, grant }: NonNullable<PendingAction>) {
    setPending({ userId, permission, grant });
  }

  function onReauthenticated() {
    const action = pending;
    setPending(null);
    if (!action) return;
    perform(action).catch(() => {});
  }

  async function perform(action: NonNullable<PendingAction>) {
    setError(null);
    setNotice(null);
    try {
      const [userId, permission] = [action.userId, action.permission];
      const res = await fetch("/api/admin/permissions", {
        method: action.grant ? "POST" : "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, permission }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "Action failed. Please try again.");
        return;
      }
      setNotice(
        `${action.grant ? "Granted" : "Revoked"} ${permission} ${
          action.grant ? "to" : "from"
        } the user.`
      );
      router.refresh();
    } catch {
      setError("A network error occurred. Please try again.");
    }
  }

  function close() {
    setPending(null);
  }

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold text-zinc-900">Permissions</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Grant or revoke granular permissions. Sensitive permissions require
        re-authentication.
      </p>

      {notice && (
        <div
          role="status"
          className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-emerald-200"
        >
          {notice}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200"
        >
          {error}
        </div>
      )}

      <div className="mt-6 overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">User</th>
              {groups.map((g) => (
                <th key={g.key} className="px-3 py-3 font-medium">
                  {g.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {users.map((user) => {
              const set = new Set(user.permissions);
              return (
                <tr key={user.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-zinc-900">
                      {user.name || "(no name)"}
                    </p>
                    <p className="text-xs text-zinc-500">{user.email}</p>
                  </td>
                  {groups.map((g) => {
                    const granted = g.permissions.filter((p) => set.has(p));
                    return (
                      <td key={g.key} className="px-3 py-3">
                        {granted.length === 0 ? (
                          <span className="text-zinc-400">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {granted.map((p) => {
                              const sensitive = sensitivePermissions.includes(p);
                              return (
                                <button
                                  key={p}
                                  type="button"
                                  onClick={() =>
                                    submit({ userId: user.id, permission: p, grant: false })
                                  }
                                  title={`Revoke ${p}`}
                                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                                    sensitive
                                      ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100"
                                      : "bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-200"
                                  }`}
                                >
                                  {p}
                                  <span aria-hidden>×</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ReauthModal
        open={pending !== null}
        onClose={close}
        onReauthenticated={onReauthenticated}
        title={
          pending?.grant
            ? "Re-authenticate to grant"
            : "Re-authenticate to revoke"
        }
        description="Granting or revoking a permission requires you to re-enter your password to restore the 30-second elevated window."
      />
    </div>
  );
}
