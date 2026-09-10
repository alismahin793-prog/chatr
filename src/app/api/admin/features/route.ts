import { NextResponse } from "next/server";
import { requireAdminIdentity } from "@/server/admin/security";
import { listFeatures } from "@/server/features/registry";
import { toApiError } from "@/server/api/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/features
 * Lists the full features registry (including disabled entries). Any admin
 * may view it; toggling requires MANAGE_FEATURES with a fresh re-auth window
 * (handled in the [key] route).
 */
export async function GET() {
  try {
    const ctx = await requireAdminIdentity();
    const features = await listFeatures(ctx.service);
    return NextResponse.json({ features });
  } catch (err) {
    return toApiError(err);
  }
}