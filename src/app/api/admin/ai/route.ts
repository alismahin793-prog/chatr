import { NextResponse } from "next/server";
import { requireAdminIdentity } from "@/server/admin/security";
import { getAiUsageStats } from "@/server/ai/usage";
import { toApiError } from "@/server/api/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/ai
 * AI request telemetry for the "AI & Usage" section. Requires super_admin
 * identity. Shows counts only — never message content or keys.
 */
export async function GET() {
  try {
    const ctx = await requireAdminIdentity();
    const usage = await getAiUsageStats(ctx.service);
    return NextResponse.json({ usage });
  } catch (err) {
    return toApiError(err);
  }
}