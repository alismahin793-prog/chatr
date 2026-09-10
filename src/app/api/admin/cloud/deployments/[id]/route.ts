import { NextResponse } from "next/server";
import { requireAdminIdentity } from "@/server/admin/security";
import { toApiError } from "@/server/api/helpers";
import { getDeploymentRow, syncDeploymentResult } from "@/server/cloud/service";
import { getDeploymentProvider } from "@/server/cloud/deploy/providers";
import { uuidParam } from "@/app/api/admin/cloud/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/cloud/deployments/:id
 * Deployment detail, refreshed against the real provider when the row still
 * points at a provider request. Read-only: super_admin identity.
 */
export async function GET(request: Request, params: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params.params;
    const deploymentId = uuidParam(id, "deployment id");
    const ctx = await requireAdminIdentity();
    const deployment = await getDeploymentRow(ctx.service, deploymentId);

    let refreshed: { status: string; url: string | null } | null = null;
    if (deployment.request_id) {
      const provider = getDeploymentProvider();
      if (provider.status().configured) {
        try {
          const live = await provider.getDeployment(deployment.request_id);
          await syncDeploymentResult(ctx.service, deploymentId, {
            status: live.status,
            url: live.url,
          });
          refreshed = { status: live.status, url: live.url };
        } catch {
          refreshed = null; // provider transient error; keep stored state
        }
      }
    }

    return NextResponse.json({ deployment, refreshed });
  } catch (err) {
    return toApiError(err);
  }
}