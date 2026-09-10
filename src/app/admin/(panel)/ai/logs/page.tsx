import { requireAdminIdentity } from "@/server/admin/security";
import { listAiRequestLogs } from "@/server/ai/usage";
import AdminSection from "@/components/admin/AdminSection";
import AiLogsTable from "@/components/admin/pages/AiLogsTable";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * AI Request Logs page. Requires super_admin identity (enforced server-side).
 * Metadata-only trail: who called which provider with which model, when.
 * Message content is never stored, so the logs can never leak conversation
 * text.
 */
export default async function AdminAiRequestLogsPage() {
  const ctx = await requireAdminIdentity();
  const logs = await listAiRequestLogs(ctx.service, 200);

  return (
    <AdminSection
      titleKey="pages.aiLogs.title"
      descriptionKey="pages.aiLogs.description"
    >
      <AiLogsTable logs={logs} />
    </AdminSection>
  );
}
