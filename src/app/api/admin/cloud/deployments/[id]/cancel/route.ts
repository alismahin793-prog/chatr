import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin/security";
import { logAdminAction } from "@/server/admin/audit";
import { toApiError } from "@/server/api/helpers";
import { getDeploymentRow, syncDeploymentResult } from "@/server/cloud/service";
import { getDeploymentProvider } from "@/server/cloud/deploy/providers";
import { uuidParam } from "@/app/api/admin/cloud/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/cloud/deployments/:id/cancel
 * Cancels a building deployment at the provider (when still cancellable) and
 * marks the row cancelled. Re-auth required.
 */
export async function POST(request: Request, params: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params.params;
    const deploymentId = uuidParam(id, "deployment id");
    const ctx = await requireAdmin();
    const deployment = await getDeploymentRow(ctx.service, deploymentId);

    if (deployment.request_id && (deployment.status === "queued" || deployment.status === "building")) {
      const provider = getDeploymentProvider();
      if (provider.status().configured) {
        try {
          await provider.cancelDeployment(deployment.request_id);
        } catch {
          // provider may have already finished the build; still mark locally
        }
      }
    }
    await syncDeploymentResult(ctx.service, deploymentId, { status: "cancelled" });

    await logAdminAction(ctx.service, {
      actorId: ctx.user.id,
      action: "admin.cloud.deployment.cancel",
      resourceType: "cloud_deployment",
      resourceId: deploymentId,
      success: true,
      metadata: { projectId: deployment.project_id },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toApiError(err);
  }
}