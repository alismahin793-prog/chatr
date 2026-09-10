import type { Metadata } from "next";
import { AdminLanguageProvider } from "@/i18n/LanguageProvider";
import DeniedContent from "@/components/admin/denied/DeniedContent";

export const metadata: Metadata = {
  title: "Access Denied",
};

/**
 * Access-denied landing for signed-in users who do NOT hold the Admin role.
 * Deliberately OUTSIDE the (panel) route group so this page does not run the
 * admin authorization guard — otherwise a denied user would loop back here.
 */
export default function AdminDeniedPage() {
  return (
    <AdminLanguageProvider>
      <DeniedContent />
    </AdminLanguageProvider>
  );
}