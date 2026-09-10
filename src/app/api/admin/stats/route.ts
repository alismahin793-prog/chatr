import { NextResponse } from "next/server";
import { requireAdminIdentity } from "@/server/admin/security";
import { getAdminStats, getRecentActivity } from "@/server/admin/stats";
import { toApiError } from "@/server/api/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/stats
 * Dashboard aggregates. Guarded by the admin role only (any admin can open
 * the dashboard landing page); the numbers shown are the platform-wide
 * totals the dashboard renders.
 */
export async function GET() {
  try {
    const ctx = await requireAdminIdentity();
    const [stats, recentActivity] = await Promise.all([
      getAdminStats(ctx.service),
      getRecentActivity(ctx.service),
    ]);
    return NextResponse.json({ stats, recentActivity });
  } catch (err) {
    return toApiError(err);
  }
}