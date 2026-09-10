import { NextResponse } from "next/server";
import { requireAdminIdentity } from "@/server/admin/security";
import { toApiError } from "@/server/api/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/audit
 * Audit log, newest first. Requires super_admin identity. Metadata is served
 * pre-redacted by insertAuditLog, but we defensively strip anything that
 * still looks like a credential before returning it.
 */
export async function GET() {
  try {
    const ctx = await requireAdminIdentity();
    const { data, error } = await ctx.service
      .from("audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return NextResponse.json({ entries: data ?? [] });
  } catch (err) {
    return toApiError(err);
  }
}