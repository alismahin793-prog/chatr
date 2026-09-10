import { requireAdminIdentity } from "@/server/admin/security";
import ImprovementsManager from "@/components/admin/ImprovementsManager";

/**
 * Improvement proposals page. Any admin may view the proposal trail; creating
 * requires create_dev_requests, and reviewing requires a fresh re-auth window
 * plus approve_dev_plans — both enforced server-side by the API routes.
 */
export default async function AdminImprovementsPage() {
  await requireAdminIdentity();
  return <ImprovementsManager />;
}