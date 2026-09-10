"use client";

import { useCallback, useEffect, useState } from "react";
import ReauthModal from "@/components/admin/ReauthModal";
import AdminSection from "@/components/admin/AdminSection";
import { CAPABILITY_LABELS } from "@/server/auth/capabilities";
import { useAdminI18n } from "@/i18n/LanguageProvider";

export interface TestUser {
  id: string;
  email: string;
  displayName: string | null;
  status: "active" | "disabled";
  isTestUser: boolean;
  expiresAt: string | null;
  createdAt: string;
  capabilities: string[];
}

const CAPABILITIES = Object.keys(CAPABILITY_LABELS);

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(body?.error?.message ?? "Request failed.");
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

type Pending = {
  title: string;
  description: string;
  run: () => Promise<void>;
} | null;

/**
 * Admin Panel test-user manager. Every mutation re-enters the 30-second
 * elevated window via the ReauthModal; the server independently enforces the
 * admin role + permission + window on every endpoint. Capabilities granted
 * here are application features only — never admin access.
 */
export default function TestUsersManager() {
  const { t } = useAdminI18n();
  const [users, setUsers] = useState<TestUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draftCaps, setDraftCaps] = useState<Record<string, string[]>>({});
  const [passwords, setPasswords] = useState<Record<string, string>>({});

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newStatus, setNewStatus] = useState<"active" | "disabled">("active");
  const [expiresAt, setExpiresAt] = useState("");
  const [createCaps, setCreateCaps] = useState<string[]>(["chat"]);

  const [now, setNow] = useState(0);

  const refresh = useCallback(async () => {
    const { users: list } = await api<{ users: TestUser[] }>("/api/admin/users");
    setNow(Date.now());
    setUsers(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/users", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(t("people.testUsers.loadError"));
        const body = (await res.json()) as { users: TestUser[] };
        if (cancelled) return;
        setNow(Date.now());
        setUsers(body.users);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(t("people.testUsers.loadError"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  function toast(message: string) {
    setNotice(message);
    setError(null);
  }

  function queue(title: string, description: string, run: () => Promise<void>) {
    setPending({ title, description, run });
  }

  function onReauthenticated() {
    const action = pending;
    setPending(null);
    if (!action) return;
    action
      .run()
      .then(() => {
        toast(t("people.testUsers.actionDone"));
        return refresh();
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : t("people.testUsers.actionFailed"))
      );
  }

  async function createTestUser() {
    if (password !== confirmPassword) {
      setError(t("people.testUsers.passwordMismatch"));
      return;
    }
    await api<{ user: TestUser }>("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email,
        displayName,
        password,
        permissions: createCaps,
        status: newStatus,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      }),
    });
    setEmail("");
    setDisplayName("");
    setPassword("");
    setConfirmPassword("");
    setExpiresAt("");
    setCreateCaps(["chat"]);
  }

  function createPending() {
    queue(
      t("people.testUsers.reauthCreateTitle"),
      t("people.testUsers.reauthCreateDesc"),
      createTestUser
    );
  }

  async function toggleStatus(user: TestUser) {
    await api<{ user: TestUser }>(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: user.status === "active" ? "disabled" : "active",
      }),
    });
  }

  async function savePermissions(userId: string) {
    await api<{ user: TestUser }>(`/api/admin/users/${userId}/permissions`, {
      method: "PATCH",
      body: JSON.stringify({ permissions: draftCaps[userId] ?? [] }),
    });
  }

  async function resetPassword(userId: string) {
    const pw = passwords[userId];
    if (!pw || pw.length < 6) {
      setError(t("people.testUsers.passwordMinLength"));
      return;
    }
    await api<{ ok: boolean }>(`/api/admin/users/${userId}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ password: pw }),
    });
    setPasswords((prev) => ({ ...prev, [userId]: "" }));
  }

  async function deleteUser(user: TestUser) {
    if (!window.confirm(t("people.testUsers.revokeConfirm", { email: user.email }))) {
      return;
    }
    await api<never>(`/api/admin/users/${user.id}`, { method: "DELETE" });
    setExpandedId(null);
  }

  function toggleCap(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  const capabilityOptions = CAPABILITIES.map((key) => ({
    key,
    label: CAPABILITY_LABELS[key as keyof typeof CAPABILITY_LABELS],
  }));

  return (
    <div className="max-w-6xl">
      <AdminSection
        titleKey="people.testUsers.title"
        descriptionKey="people.testUsers.description"
      />

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

      {/* ---------------- Create form ---------------- */}
      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-zinc-900">{t("people.testUsers.createTitle")}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-zinc-700">{t("people.testUsers.displayName")}</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-zinc-700">{t("people.testUsers.email")}</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="test@example.com"
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-zinc-700">{t("people.testUsers.password")}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              placeholder="••••••••"
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-zinc-700">{t("people.testUsers.confirmPassword")}</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              placeholder="••••••••"
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-zinc-700">{t("common.status")}</span>
            <select
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value as "active" | "disabled")}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            >
              <option value="active">{t("people.status.active")}</option>
              <option value="disabled">{t("people.status.disabled")}</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-zinc-700">
              {t("people.testUsers.expiresOptional")}
            </span>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          </label>
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-zinc-700">
            {t("people.testUsers.capabilities")}
          </legend>
          <div className="mt-2 flex flex-wrap gap-4">
            {capabilityOptions.map((cap) => (
              <label key={cap.key} className="flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={createCaps.includes(cap.key)}
                  onChange={() => setCreateCaps((prev) => toggleCap(prev, cap.key))}
                  className="size-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                />
                {cap.label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {t("people.testUsers.capabilitiesNotice")}
          </p>
        </fieldset>

        <div className="mt-5">
          <button
            type="button"
            onClick={createPending}
            disabled={loading}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {t("people.testUsers.createUser")}
          </button>
        </div>
      </section>

      {/* ---------------- User list ---------------- */}
      <section className="mt-6 overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-start text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">{t("people.testUsers.user")}</th>
              <th className="px-3 py-3 font-medium">{t("common.status")}</th>
              <th className="px-3 py-3 font-medium">{t("people.testUsers.capabilities")}</th>
              <th className="px-3 py-3 font-medium">{t("people.accounts.expires")}</th>
              <th className="px-3 py-3 font-medium">{t("common.created")}</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {!loading && users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-zinc-400">
                  {t("people.testUsers.emptyList")}
                </td>
              </tr>
            )}
            {users.map((user) => (
              <TestUserRow
                key={user.id}
                user={user}
                now={now}
                expanded={expandedId === user.id}
                draft={draftCaps[user.id] ?? user.capabilities}
                options={capabilityOptions}
                newPassword={passwords[user.id] ?? ""}
                onToggleExpand={() => {
                  setExpandedId((cur) => (cur === user.id ? null : user.id));
                  setDraftCaps((prev) => ({ ...prev, [user.id]: user.capabilities }));
                }}
                onCapabilityChange={(value) =>
                  setDraftCaps((prev) => ({
                    ...prev,
                    [user.id]: toggleCap(prev[user.id] ?? user.capabilities, value),
                  }))
                }
                onPasswordChange={(value) =>
                  setPasswords((prev) => ({ ...prev, [user.id]: value }))
                }
                onToggleStatus={() =>
                  queue(
                    t("people.testUsers.reauthStatusTitle"),
                    t("people.testUsers.reauthStatusDesc"),
                    () => toggleStatus(user)
                  )
                }
                onSavePermissions={() =>
                  queue(
                    t("people.testUsers.reauthPermissionsTitle"),
                    t("people.testUsers.reauthPermissionsDesc"),
                    () => savePermissions(user.id)
                  )
                }
                onResetPassword={() =>
                  queue(
                    t("people.testUsers.reauthPasswordTitle"),
                    t("people.testUsers.reauthPasswordDesc"),
                    () => resetPassword(user.id)
                  )
                }
                onDelete={() =>
                  queue(
                    t("people.testUsers.reauthRevokeTitle"),
                    t("people.testUsers.reauthRevokeDesc"),
                    () => deleteUser(user)
                  )
                }
              />
            ))}
          </tbody>
        </table>
      </section>

      <ReauthModal
        open={pending !== null}
        onClose={() => setPending(null)}
        onReauthenticated={onReauthenticated}
        title={pending?.title ?? t("people.testUsers.reauthDefaultTitle")}
        description={
          pending?.description ??
          t("people.testUsers.reauthDefaultDesc")
        }
      />
    </div>
  );
}

interface TestUserRowProps {
  user: TestUser;
  now: number;
  expanded: boolean;
  draft: string[];
  options: { key: string; label: string }[];
  newPassword: string;
  onToggleExpand: () => void;
  onCapabilityChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onToggleStatus: () => void;
  onSavePermissions: () => void;
  onResetPassword: () => void;
  onDelete: () => void;
}

function TestUserRow({
  user,
  now,
  expanded,
  draft,
  options,
  newPassword,
  onToggleExpand,
  onCapabilityChange,
  onPasswordChange,
  onToggleStatus,
  onSavePermissions,
  onResetPassword,
  onDelete,
}: TestUserRowProps) {
  const { t } = useAdminI18n();
  const disabled = user.status === "disabled";
  const expired =
    user.expiresAt !== null &&
    now !== 0 &&
    Date.parse(user.expiresAt) <= now;
  return (
    <>
      <tr className="hover:bg-zinc-50">
        <td className="px-4 py-3">
          <p className="font-medium text-zinc-900">
            {user.displayName || t("people.accounts.noName")}
          </p>
          <p className="text-xs text-zinc-500">{user.email}</p>
        </td>
        <td className="px-3 py-3">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
              disabled
                ? "bg-red-50 text-red-700 ring-1 ring-red-200"
                : expired
                  ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                  : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
            }`}
          >
            {disabled ? t("people.status.disabled") : expired ? t("people.testUsers.statusExpired") : t("people.status.active")}
          </span>
        </td>
        <td className="px-3 py-3">
          {user.capabilities.length === 0 ? (
            <span className="text-zinc-400">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {user.capabilities.map((c) => (
                <span
                  key={c}
                  className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200"
                >
                  {CAPABILITY_LABELS[c as keyof typeof CAPABILITY_LABELS] ?? c}
                </span>
              ))}
            </div>
          )}
        </td>
        <td className="px-3 py-3 text-zinc-600">{formatDate(user.expiresAt)}</td>
        <td className="px-3 py-3 text-zinc-600">{formatDate(user.createdAt)}</td>
        <td className="px-3 py-3 text-end">
          <button
            type="button"
            onClick={onToggleExpand}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
          >
            {expanded ? t("common.close") : t("people.testUsers.manage")}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} className="bg-zinc-50 px-6 py-5">
            <div className="grid gap-6 lg:grid-cols-2">
              <section>
                <h3 className="text-sm font-semibold text-zinc-900">{t("people.testUsers.capabilities")}</h3>
                <div className="mt-2 flex flex-wrap gap-4">
                  {options.map((cap) => (
                    <label
                      key={cap.key}
                      className="flex items-center gap-2 text-sm text-zinc-700"
                    >
                      <input
                        type="checkbox"
                        checked={draft.includes(cap.key)}
                        onChange={() => onCapabilityChange(cap.key)}
                        className="size-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      {cap.label}
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={onSavePermissions}
                  className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                >
                  {t("people.testUsers.savePermissions")}
                </button>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-zinc-900">{t("people.accounts.account")}</h3>
                <button
                  type="button"
                  onClick={onToggleStatus}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
                    disabled ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
                  }`}
                >
                  {disabled ? t("people.testUsers.reenableUser") : t("people.testUsers.disableUser")}
                </button>

                <div className="flex flex-wrap items-end gap-2">
                  <label className="block flex-1">
                    <span className="text-sm font-medium text-zinc-700">
                      {t("people.testUsers.newPassword")}
                    </span>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => onPasswordChange(e.target.value)}
                      placeholder="••••••••"
                      className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={onResetPassword}
                    className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
                  >
                    {t("people.testUsers.resetPassword")}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={onDelete}
                  className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                >
                  {t("people.testUsers.revokeUser")}
                </button>
              </section>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
