import { NextResponse } from "next/server";
import { requireAdminIdentity } from "@/server/admin/security";
import { listAiRequestLogs } from "@/server/ai/usage";
import { toApiError } from "@/server/api/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/ai/logs
 * Recent AI request log entries for the "AI Request Logs" section. Requires
 * super_admin identity. Metadata only — no message content is ever stored.
 */
export async function GET() {
  try {
    const ctx = await requireAdminIdentity();
    const logs = await listAiRequestLogs(ctx.service);
    return NextResponse.json({ logs });
  } catch (err) {
    return toApiError(err);
  }
}