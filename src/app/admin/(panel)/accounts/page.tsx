import { requireAdminIdentity } from "@/server/admin/security";
import AccountsManager from "@/components/admin/AccountsManager";

/**
 * Account directory page. Requires super_admin identity (enforced server-side).
 * Read-only: this is the directory; lifecycle changes for test users stay on
 * the dedicated Test Users page.
 */
export default async function AdminAccountsPage() {
  await requireAdminIdentity();
  return <AccountsManager />;
}
