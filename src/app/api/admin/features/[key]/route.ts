import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin/security";
import { updateFeature } from "@/server/features/registry";
import { logAdminAction } from "@/server/admin/audit";
import { readJsonBody, toApiError } from "@/server/api/helpers";
import { formatZodError, updateFeatureSchema } from "@/server/validation/schemas";
import { ValidationError } from "@/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/admin/features/[key]
 * Updates registry metadata or toggles a feature on/off. Sensitive: requires
 * a fresh 30-second re-auth window. Toggling a feature off makes every
 * server path that enforces it refuse the request.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const ctx = await requireAdmin();
    const { key } = await params;
    const body = await readJsonBody<unknown>(request);
    const parsed = updateFeatureSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(formatZodError(parsed.error).message);
    }

    const feature = await updateFeature(ctx.service, key, parsed.data);
    await logAdminAction(ctx.service, {
      actorId: ctx.user.id,
      action: "admin.feature.update",
      resourceType: "feature",
      resourceId: feature.id,
      metadata: {
        key: feature.key,
        enabled: feature.enabled,
        availableToUsers: feature.availableToUsers,
        version: feature.version,
      },
      success: true,
    });
    return NextResponse.json({ feature });
  } catch (err) {
    return toApiError(err);
  }
}