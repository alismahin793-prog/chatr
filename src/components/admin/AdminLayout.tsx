import type { ReactNode } from "react";
import AdminSidebar from "@/components/admin/AdminSidebar";
import AdminHeader from "@/components/admin/AdminHeader";
import { AdminLanguageProvider } from "@/i18n/LanguageProvider";

interface AdminLayoutProps {
  adminName: string;
  adminEmail: string;
  children: ReactNode;
}

/**
 * Admin Console shell: dark fixed sidebar plus sticky top header and a neutral
 * content canvas. Each admin page flows through this one shell. Authorization
 * is enforced by the server layout above this component (requireAdminIdentity),
 * never by this shell.
 *
 * The i18n provider owns the console's `dir`/`lang` wrapper, so direction
 * (ltr/rtl) and language apply once here — the shell markup below uses logical
 * (ps) instead of physical (pl) offsets so it flips automatically.
 */
export default function AdminLayout({ adminName, adminEmail, children }: AdminLayoutProps) {
  return (
    <AdminLanguageProvider>
      <div className="min-h-screen bg-slate-100">
        <AdminSidebar adminName={adminName} adminEmail={adminEmail} />
        <div className="lg:ps-64">
          <AdminHeader adminName={adminName} adminEmail={adminEmail} />
          <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>
      </div>
    </AdminLanguageProvider>
  );
}