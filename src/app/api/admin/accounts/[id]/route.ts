import { NextResponse } from "next/server";
import { requireAdminIdentity } from "@/server/admin/security";
import { getAccountDetails } from "@/server/admin/accounts";
import { toApiError } from "@/server/api/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/accounts/[id]
 * Full account details: profile, auth email, admin permissions, app
 * capabilities, and conversation count. Requires super_admin identity.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAdminIdentity();
    const { id } = await params;
    const account = await getAccountDetails(ctx.service, id);
    return NextResponse.json({ account });
  } catch (err) {
    return toApiError(err);
  }
}