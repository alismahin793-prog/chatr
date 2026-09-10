import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  accountStatusMessage,
  isApprovedStatus,
  loadAccountState,
} from "@/server/auth/capabilities";
import { SUPER_ADMIN_ROLE } from "@/server/admin/security";

const STATUS_TITLES: Record<string, string> = {
  pending: "طلب الإنشاء قيد المراجعة",
  rejected: "لم تتم الموافقة على حسابك",
  disabled: "تم تعطيل حسابك",
};

const STATUS_MESSAGES: Record<string, string> = {
  pending: "تم استلام طلب إنشاء حسابك. سيتم مراجعة طلبك من الإدارة.",
  rejected: "لم تتم الموافقة على طلب إنشاء حسابك. يرجى التواصل مع الإدارة.",
  disabled: "تم تعطيل حسابك. يرجى التواصل مع الإدارة.",
};

/**
 * Account-review screen (RTL Arabic). Shown to signed-in accounts whose
 * profile status is pending/rejected/disabled (via the proxy redirect).
 * Usable accounts are bounced straight back to /chat; the super_admin owner
 * is never blocked. A blocked account cannot reach any app or admin API:
 * every API route re-enforces the lifecycle gate server-side.
 */
export default async function AccountBlockedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const state = await loadAccountState(supabase, user.id);
  if (state.role === SUPER_ADMIN_ROLE || isApprovedStatus(state.status)) {
    redirect("/chat");
  }

  const title = STATUS_TITLES[state.status] ?? "لا يمكن استخدام الحساب حالياً";
  const message =
    STATUS_MESSAGES[state.status] ??
    accountStatusMessage(state.status) ??
    "لا يمكن استخدام الحساب حالياً. يرجى التواصل مع الإدارة.";

  return (
    <main
      dir="rtl"
      className="flex min-h-screen items-center justify-center bg-zinc-50 px-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-zinc-200">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-indigo-50 text-indigo-600">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-6"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        </div>
        <h1 className="mt-4 text-xl font-semibold text-zinc-900">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-500">{message}</p>
        <form action="/auth/logout" method="post" className="mt-6">
          <button
            type="submit"
            className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
          >
            تسجيل الخروج
          </button>
        </form>
        <p className="mt-4 text-xs text-zinc-400">
          <Link href="/chat" className="hover:underline">
            المحاولة مجدداً
          </Link>{" "}
          · للاستفسار، تواصل مع الإدارة
        </p>
      </div>
    </main>
  );
}