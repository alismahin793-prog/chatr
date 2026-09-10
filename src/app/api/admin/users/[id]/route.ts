import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin/security";
import { deleteTestUser, updateTestUser } from "@/server/admin/testUsers";
import { logAdminAction } from "@/server/admin/audit";
import { readJsonBody, toApiError } from "@/server/api/helpers";
import {
  formatZodError,
  updateTestUserSchema,
  userIdSchema,
} from "@/server/validation/schemas";
import { ValidationError } from "@/server/errors";

export const runtime = "nodejs";

async function resolveId(
  ctx: { params: Promise<{ id: string }> }
): Promise<string> {
  const { id } = await ctx.params;
  const parsed = userIdSchema.safeParse({ id });
  if (!parsed.success) {
    throw new ValidationError(formatZodError(parsed.error).message);
  }
  return parsed.data.id;
}

/**
 * Updates a test user's lifecycle/identity fields (status, expiry, display
 * name). Sensitive: requires a fresh 30-second re-auth window.
 */
export async function PATCH(
  request: Request,
  params: { params: Promise<{ id: string }> }
) {
  try {
    const id = await resolveId(params);
    const ctx = await requireAdmin();
    const body = await readJsonBody<unknown>(request);
    const parsed = updateTestUserSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(formatZodError(parsed.error).message);
    }

    const user = await updateTestUser(ctx.service, id, parsed.data);
    await logAdminAction(ctx.service, {
      actorId: ctx.user.id,
      action: "admin.testuser.update",
      resourceType: "test_user",
      resourceId: user.id,
      metadata: {
        email: user.email,
        status: parsed.data.status ?? undefined,
        expiresAt: parsed.data.expiresAt ?? undefined,
      },
      success: true,
    });
    return NextResponse.json({ user });
  } catch (err) {
    return toApiError(err);
  }
}

/**
 * Revokes a test user (soft-deletes the Auth account and marks it disabled).
 * Normal and super_admin accounts are rejected. Sensitive: requires a fresh
 * 30-second re-auth window.
 */
export async function DELETE(
  _request: Request,
  params: { params: Promise<{ id: string }> }
) {
  try {
    const id = await resolveId(params);
    const ctx = await requireAdmin();
    await deleteTestUser(ctx.service, id);
    await logAdminAction(ctx.service, {
      actorId: ctx.user.id,
      action: "admin.testuser.delete",
      resourceType: "test_user",
      resourceId: id,
      success: true,
    });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toApiError(err);
  }
}
