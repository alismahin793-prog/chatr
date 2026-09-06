import { NextResponse } from "next/server";
import { z } from "zod";
import {
  PERMISSIONS,
  grantPermission,
  revokePermission,
  requireSensitivePermission,
  isValidPermission,
} from "@/server/admin/permissions";
import { requireAdminIdentity } from "@/server/admin/security";
import { logAdminAction } from "@/server/admin/audit";
import { readJsonBody, toApiError } from "@/server/api/helpers";
import { formatZodError } from "@/server/validation/schemas";
import { ValidationError } from "@/server/errors";

export const runtime = "nodejs";

const permissionInputSchema = z.object({
  userId: z.string().uuid("Invalid user id."),
  permission: z.string().min(1, "Permission is required."),
});

/**
 * GET /api/admin/permissions
 * Returns the caller's own granted permissions so the Admin Panel can render
 * its sidebar and dashboard. Requires: admin role. This is a read of the
 * caller's own grants, so it does not need a further permission or re-auth
 * window.
 */
export async function GET() {
  try {
    const { service, user } = await requireAdminIdentity();
    const { data } = await service
      .from("admin_permissions")
      .select("user_id, permission")
      .eq("user_id", user.id);
    const permissions = (data ?? []).map((row) => row.permission);
    await logAdminAction(service, {
      actorId: user.id,
      action: "admin.permissions.list",
      resourceType: "admin",
      resourceId: user.id,
      success: true,
    });
    return NextResponse.json({ permissions });
  } catch (err) {
    return toApiError(err);
  }
}

/**
 * POST /api/admin/permissions
 * Grants a permission to a user. Requires: admin role + active re-auth
 * window + manage_user_roles permission.
 */
export async function POST(request: Request) {
  try {
    const { service, user } = await requireSensitivePermission(
      PERMISSIONS.MANAGE_USER_ROLES
    );
    const body = await readJsonBody<unknown>(request);
    const parsed = permissionInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(formatZodError(parsed.error).message);
    }
    const { userId, permission } = parsed.data;
    if (!isValidPermission(permission)) {
      throw new ValidationError(`Unknown permission: ${permission}`);
    }

    await grantPermission(service, userId, permission, user.id);
    await logAdminAction(service, {
      actorId: user.id,
      action: "admin.permissions.grant",
      resourceType: "user",
      resourceId: userId,
      success: true,
      metadata: { permission },
    });

    return NextResponse.json({ ok: true, userId, permission });
  } catch (err) {
    return toApiError(err);
  }
}

/**
 * DELETE /api/admin/permissions
 * Revokes a permission from a user. Requires: admin role + active re-auth
 * window + manage_user_roles permission.
 */
export async function DELETE(request: Request) {
  try {
    const { service, user } = await requireSensitivePermission(
      PERMISSIONS.MANAGE_USER_ROLES
    );
    const body = await readJsonBody<unknown>(request);
    const parsed = permissionInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(formatZodError(parsed.error).message);
    }
    const { userId, permission } = parsed.data;
    if (!isValidPermission(permission)) {
      throw new ValidationError(`Unknown permission: ${permission}`);
    }

    await revokePermission(service, userId, permission);
    await logAdminAction(service, {
      actorId: user.id,
      action: "admin.permissions.revoke",
      resourceType: "user",
      resourceId: userId,
      success: true,
      metadata: { permission },
    });

    return NextResponse.json({ ok: true, userId, permission });
  } catch (err) {
    return toApiError(err);
  }
}