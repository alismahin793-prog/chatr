"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ReauthModalProps {
  open: boolean;
  onClose: () => void;
  onReauthenticated: () => void;
  title?: string;
  description?: string;
}

/**
 * Client-side modal that prompts an admin to re-enter their password to
 * restore the 30-second elevated window needed for sensitive actions. The
 * password is sent to /api/admin/reauth and verified server-side; it is
 * never stored or logged.
 */
export default function ReauthModal({
  open,
  onClose,
  onReauthenticated,
  title = "Re-authenticate",
  description = "This action requires you to re-enter your password to confirm your identity.",
}: ReauthModalProps) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/reauth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(
          body?.error?.message ?? "Re-authentication failed. Please try again."
        );
        setPassword("");
        return;
      }
      setPassword("");
      onReauthenticated();
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setSubmitting(false);
      router.refresh();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg ring-1 ring-zinc-200"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
        <p className="mt-1 text-sm text-zinc-500">{description}</p>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200"
          >
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-zinc-700">Password</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
          </label>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Verifying…" : "Confirm"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
