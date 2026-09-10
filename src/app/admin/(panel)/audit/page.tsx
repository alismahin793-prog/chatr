import { requireAdminIdentity } from "@/server/admin/security";
import AuditLogViewer from "@/components/admin/AuditLogViewer";

/**
 * Audit log page. Requires super_admin identity (enforced server-side).
 * Rows are served pre-redacted by the write path; the viewer renders them
 * read-only.
 */
export default async function AdminAuditPage() {
  await requireAdminIdentity();
  return <AuditLogViewer />;
}
