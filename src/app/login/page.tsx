import Link from "next/link";
import AuthForm from "@/components/auth/AuthForm";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 inline-flex items-center gap-2 text-lg font-semibold">
          <span className="grid size-8 place-items-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
            C
          </span>
          Chatr
        </Link>
        <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <AuthForm mode="login" />
        </div>
      </div>
    </main>
  );
}