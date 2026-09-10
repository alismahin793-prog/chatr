import { NextResponse } from "next/server";
import { requireAdminIdentity } from "@/server/admin/security";
import { toApiError } from "@/server/api/helpers";
import { executionProviderStatus } from "@/server/cloud/execution/providers";
import { getWorkspaceProvider } from "@/server/cloud/workspace/providers";
import { getGitProvider } from "@/server/cloud/git/providers";
import { deploymentProviderStatus } from "@/server/cloud/deploy/providers";
import { CLOUD_PIPELINE_STEPS } from "@/server/cloud/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/cloud/providers
 * Honest status of every Cloud Development provider plus the approved pipeline
 * catalogue. Nothing is ever reported as "configured" unless it really is.
 * Read-only: super_admin identity.
 */
export async function GET() {
  try {
    await requireAdminIdentity();
    const workspace = getWorkspaceProvider().status();
    const git = getGitProvider().providerStatus();
    return NextResponse.json({
      providers: {
        execution: executionProviderStatus(),
        workspace,
        git,
        deployment: deploymentProviderStatus(),
      },
      pipeline: CLOUD_PIPELINE_STEPS,
    });
  } catch (err) {
    return toApiError(err);
  }
}