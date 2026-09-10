import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin/security";
import { logAdminAction } from "@/server/admin/audit";
import { readJsonBody, toApiError } from "@/server/api/helpers";
import { cloudRollbackSchema, formatZodError } from "@/server/validation/schemas";
import { ValidationError } from "@/server/errors";
import {
  assertProjectActive,
  getProjectOrThrow,
  getDeploymentRow,
  syncDeploymentResult,
  markDeploymentRolledBack,
  createDeploymentRow,
} from "@/server/cloud/service";
import { getDeploymentProvider } from "@/server/cloud/deploy/providers";
import { getWorkspaceProvider } from "@/server/cloud/workspace/providers";
import { getGitProvider } from "@/server/cloud/git/providers";
import { uuidParam } from "@/app/api/admin/cloud/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const workspace = getWorkspaceProvider();
const git = getGitProvider();

/**
 * POST /api/admin/cloud/deployments/:id/rollback  { confirm: true }
 *
 * True rollback: checks out the deployment's code ref back into the workspace,
 * then creates a NEW production deployment from that code (real, provider
 * confirmed). Nothing is ever force-pushed or history-rewritten. Requires a
 * clean working tree and explicit confirmation. Re-auth required.
 */
export async function POST(request: Request, params: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params.params;
    const deploymentId = uuidParam(id, "deployment id");
    const ctx = await requireAdmin();

    const body = await readJsonBody<unknown>(request);
    const parsed = cloudRollbackSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).message);
    if (parsed.data.deploymentId !== deploymentId) {
      throw new ValidationError("Deployment id mismatch.");
    }

    const deployment = await getDeploymentRow(ctx.service, deploymentId);
    if (deployment.kind !== "production") {
      throw new ValidationError("Only production deployments can be rolled back through this flow.");
    }
    if (!deployment.ref) throw new ValidationError("Deployment has no restorable ref.");

    const project = await getProjectOrThrow(ctx.service, deployment.project_id);
    assertProjectActive(project);

    const provider = getDeploymentProvider();
    if (!provider.status().configured) {
      throw new ValidationError(
        "The deployment provider is not configured (VERCEL_TOKEN / VERCEL_PROJECT_ID)."
      );
    }

    const root = workspace.resolveRoot(project.id);
    await git.checkout(root, deployment.ref); // safe: refuses on a dirty tree

    const redeploy = await createDeploymentRow(ctx.service, {
      projectId: project.id,
      kind: "production",
      ref: deployment.ref,
      branch: deployment.branch,
      initiatedBy: ctx.user.id,
    });

    try {
      const created = await provider.createDeployment({
        projectId: project.id,
        ref: deployment.ref,
        branch: deployment.branch ?? project.default_branch,
        workspaceRoot: root,
        kind: "production",
      });
      await syncDeploymentResult(ctx.service, redeploy.id, {
        status: created.status,
        url: created.url,
      });
    } catch (err) {
      await syncDeploymentResult(ctx.service, redeploy.id, { status: "failed" });
      throw err;
    }

    await markDeploymentRolledBack(ctx.service, deploymentId);

    await logAdminAction(ctx.service, {
      actorId: ctx.user.id,
      action: "admin.cloud.deployment.rollback",
      resourceType: "cloud_deployment",
      resourceId: redeploy.id,
      success: true,
      metadata: {
        project: project.slug,
        fromDeploymentId: deploymentId,
        ref: deployment.ref,
      },
    });

    return NextResponse.json({
      ok: true,
      rollback: {
        from: deploymentId,
        to: redeploy.id,
        ref: deployment.ref,
        status: "building",
      },
    });
  } catch (err) {
    return toApiError(err);
  }
}