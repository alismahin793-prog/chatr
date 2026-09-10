import { NextResponse } from "next/server";
import { requireAdminIdentity } from "@/server/admin/security";
import { getSystemErrors, getSystemHealth } from "@/server/admin/system";
import { toApiError } from "@/server/api/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/system
 * System health plus the recent failed-action list. Requires super_admin
 * identity.
 */
export async function GET() {
  try {
    const ctx = await requireAdminIdentity();
    const health = await getSystemHealth(ctx.service);
    const errors = await getSystemErrors(ctx.service);

    return NextResponse.json({ health, errors });
  } catch (err) {
    return toApiError(err);
  }
}