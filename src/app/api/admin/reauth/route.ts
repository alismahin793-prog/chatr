import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_TTL_MS,
  ADMIN_SESSION_TTL_SECONDS,
  clearAdminVerified,
  markAdminVerified,
  requireAdminIdentity,
  verifyPassword,
} from "@/server/admin/security";
import { logAdminAction } from "@/server/admin/audit";
import { readJsonBody, toApiError } from "@/server/api/helpers";
import { formatZodError, reauthSchema } from "@/server/validation/schemas";
import { ReauthFailedError, ValidationError } from "@/server/errors";

export const runtime = "nodejs";

/**
 * POST /api/admin/reauth
 * Re-authenticates an admin with their Supabase account password (verified
 * server-side via GoTrue). On success the admin's elevation window is reset.
 * The password is never stored, logged, or returned.
 */
export async function POST(request: Request) {
  try {
    const { supabase, service, user } = await requireAdminIdentity();
    const body = await readJsonBody<unknown>(request);
    const parsed = reauthSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(formatZodError(parsed.error).message);
    }

    const result = await verifyPassword(supabase, user.email ?? "", parsed.data.password);

    if (!result.ok) {
      // A failed password check revokes any stale elevation.
      await clearAdminVerified(service, user.id);
      await logAdminAction(service, {
        actorId: user.id,
        action: "admin.reauth",
        resourceType: "user",
        resourceId: user.id,
        success: false,
      });
      throw new ReauthFailedError();
    }

    const verifiedAt = new Date().toISOString();
    await markAdminVerified(service, user.id, verifiedAt);
    await logAdminAction(service, {
      actorId: user.id,
      action: "admin.reauth",
      resourceType: "user",
      resourceId: user.id,
      success: true,
      metadata: { expiresInSeconds: ADMIN_SESSION_TTL_SECONDS },
    });

    return NextResponse.json({
      ok: true,
      expiresAt: new Date(Date.parse(verifiedAt) + ADMIN_SESSION_TTL_MS).toISOString(),
    });
  } catch (err) {
    return toApiError(err);
  }
}