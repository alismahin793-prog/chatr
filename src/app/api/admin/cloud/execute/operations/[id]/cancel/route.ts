import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin/security";
import { logAdminAction } from "@/server/admin/audit";
import { toApiError } from "@/server/api/helpers";
import { getOperation } from "@/server/cloud/service";
import { getExecutionProvider } from "@/server/cloud/execution/providers";
import { finalizeOperation } from "@/server/cloud/execution/finalize";
import { uuidParam } from "@/app/api/admin/cloud/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/cloud/execute/operations/:id/cancel
 * Cancels a running provider process and marks the stored operation cancelled.
 * Sensitive: requires a fresh 30-second re-auth window.
 */
export async function POST(request: Request, params: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params.params;
    const opId = uuidParam(id, "operation id");
    const ctx = await requireAdmin();

    const operation = await getOperation(ctx.service, opId);
    const provider = getExecutionProvider();
    if (provider.status().configured) {
      try {
        await provider.cancel(opId);
      } catch {
        // process unknown to this runtime (already finished / worker-only)
      }
    }

    if (operation.status === "running") {
      let chunks: { seq: number; kind: "stdout" | "stderr"; text: string }[] = [];
      try {
        chunks = provider.poll(opId, -1).newOutput;
      } catch {
        // no local output available
      }
      await finalizeOperation(ctx.service, opId, { state: "cancelled", exitCode: null }, chunks);
    }

    await logAdminAction(ctx.service, {
      actorId: ctx.user.id,
      action: "admin.cloud.operation.cancel",
      resourceType: "cloud_operation",
      resourceId: opId,
      success: true,
      metadata: { projectId: operation.project_id },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toApiError(err);
  }
}