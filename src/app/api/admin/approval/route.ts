import { NextResponse, type NextRequest } from "next/server";
import { requireAdminIdentity, requireAdmin } from "@/server/admin/security";
import {
  APPROVABLE_PARAM_VALUES,
  listAccountsByStatus,
  setAccountStatus,
} from "@/server/admin/userApproval";
import { logAdminAction } from "@/server/admin/audit";
import { readJsonBody, toApiError } from "@/server/api/helpers";
import { accountApprovalSchema, formatZodError } from "@/server/validation/schemas";
import { ValidationError } from "@/server/errors";
import type { AccountStatus } from "@/server/auth/capabilities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseStatusParam(value: string | null): AccountStatus | null {
  if (!value) return "pending";
  return (APPROVABLE_PARAM_VALUES as readonly string[]).includes(value)
    ? (value as AccountStatus)
    : null;
}

/**
 * GET /api/admin/approval?status=pending
 * Lists accounts by registration-approval status for the Approvals screen.
 * Read-only: requires super_admin identity.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAdminIdentity();
    const status = parseStatusParam(new URL(request.url).searchParams.get("status"));
    if (!status) {
      throw new ValidationError("Unknown status filter.");
    }
    const users = await listAccountsByStatus(ctx.service, [status]);
    return NextResponse.json({ users });
  } catch (err) {
    return toApiError(err);
  }
}

/**
 * POST /api/admin/approval
 * Sets an account's registration-approval status (approved / rejected /
 * disabled). Sensitive: requires a fresh 30-second re-auth window. The
 * super_admin owner is protected server-side.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin();
    const body = await readJsonBody<unknown>(request);
    const parsed = accountApprovalSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(formatZodError(parsed.error).message);
    }

    const user = await setAccountStatus(ctx.service, parsed.data.userId, parsed.data.status);
    await logAdminAction(ctx.service, {
      actorId: ctx.user.id,
      action: "admin.approval.set_status",
      resourceType: "user",
      resourceId: user.id,
      success: true,
      metadata: {
        email: user.email,
        status: parsed.data.status,
      },
    });
    return NextResponse.json({ user });
  } catch (err) {
    return toApiError(err);
  }
}