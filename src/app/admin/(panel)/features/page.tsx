import { requireAdminIdentity } from "@/server/admin/security";
import FeaturesManager from "@/components/admin/FeaturesManager";

/**
 * Features registry page. Requires super_admin identity (enforced by the
 * layout); toggles are additionally gated by a fresh 30-second
 * re-authentication window via requireAdmin().
 */
export default async function AdminFeaturesPage() {
  await requireAdminIdentity();
  return <FeaturesManager />;
}