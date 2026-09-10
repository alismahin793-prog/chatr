import { NextResponse } from "next/server";
import { requireAdminIdentity, requireAdmin } from "@/server/admin/security";
import { createTestUser, listTestUsers } from "@/server/admin/testUsers";
import { logAdminAction } from "@/server/admin/audit";
import { readJsonBody, toApiError } from "@/server/api/helpers";
import {
  createTestUserSchema,
  formatZodError,
} from "@/server/validation/schemas";
import { ValidationError } from "@/server/errors";

export const runtime = "nodejs";

/**
 * Lists test users. Requires super_admin identity (service role reads).
 */
export async function GET() {
  try {
    const ctx = await requireAdminIdentity();
    const users = await listTestUsers(ctx.service);
    await logAdminAction(ctx.service, {
      actorId: ctx.user.id,
      action: "admin.testusers.list",
      resourceType: "test_user",
      success: true,
    });
    return NextResponse.json({ users });
  } catch (err) {
    return toApiError(err);
  }
}

/**
 * Creates a test user. Sensitive: requires a fresh 30-second re-auth window.
 * The submitted password is used only to provision the Supabase Auth account;
 * it is never stored, returned, or logged.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin();
    const body = await readJsonBody<unknown>(request);
    const parsed = createTestUserSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(formatZodError(parsed.error).message);
    }

    const user = await createTestUser(ctx.service, parsed.data, ctx.user.id);
    await logAdminAction(ctx.service, {
      actorId: ctx.user.id,
      action: "admin.testuser.create",
      resourceType: "test_user",
      resourceId: user.id,
      metadata: {
        email: user.email,
        status: user.status,
        permissions: user.capabilities,
        expiresAt: user.expiresAt ?? null,
      },
      success: true,
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    return toApiError(err);
  }
}
