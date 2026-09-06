import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin/security";
import { logAdminAction } from "@/server/admin/audit";
import { toApiError } from "@/server/api/helpers";

export const runtime = "nodejs";

/**
 * GET /api/admin/status
 * Sample non-destructive, fully-guarded admin route. Any future admin route
 * must start with requireAdmin() so authorization happens server-side.
 * Returns the state of the caller's admin elevation, if any.
 */
export async function GET() {
  try {
    const { service, user, verifiedAt, expiresAt } = await requireAdmin();
    await logAdminAction(service, {
      actorId: user.id,
      action: "admin.status",
      resourceType: "admin",
      resourceId: user.id,
      success: true,
    });
    return NextResponse.json({ admin: true, verifiedAt, expiresAt });
  } catch (err) {
    return toApiError(err);
  }
}