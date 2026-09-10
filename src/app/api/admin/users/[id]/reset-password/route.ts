import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin/security";
import { resetTestUserPassword } from "@/server/admin/testUsers";
import { logAdminAction } from "@/server/admin/audit";
import { readJsonBody, toApiError } from "@/server/api/helpers";
import {
  formatZodError,
  resetTestUserPasswordSchema,
  userIdSchema,
} from "@/server/validation/schemas";
import { ValidationError } from "@/server/errors";

export const runtime = "nodejs";

/**
 * Resets a test user's password via the Supabase Auth admin API. The new
 * password is only ever forwarded to Supabase Auth — it is never returned in
 * the response and never written to the audit log. Sensitive: requires a
 * fresh 30-second re-auth window.
 */
export async function POST(
  request: Request,
  params: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params.params;
    const parsedId = userIdSchema.safeParse({ id });
    if (!parsedId.success) {
      throw new ValidationError(formatZodError(parsedId.error).message);
    }

    const ctx = await requireAdmin();
    const body = await readJsonBody<unknown>(request);
    const parsed = resetTestUserPasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(formatZodError(parsed.error).message);
    }

    await resetTestUserPassword(ctx.service, parsedId.data.id, parsed.data.password);
    await logAdminAction(ctx.service, {
      actorId: ctx.user.id,
      action: "admin.testuser.password_reset",
      resourceType: "test_user",
      resourceId: parsedId.data.id,
      success: true,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toApiError(err);
  }
}