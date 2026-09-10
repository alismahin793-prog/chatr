import { NextResponse } from "next/server";
import { requireAdmin, requireAdminIdentity } from "@/server/admin/security";
import { logAdminAction } from "@/server/admin/audit";
import { readJsonBody, toApiError } from "@/server/api/helpers";
import { cloudDeploySchema, formatZodError } from "@/server/validation/schemas";
import { ValidationError } from "@/server/errors";
import {
  assertProjectActive,
  getProjectOrThrow,
  listDeployments,
  createDeploymentRow,
  syncDeploymentResult,
  touchProject,
} from "@/server/cloud/service";
import { getDeploymentProvider } from "@/server/cloud/deploy/providers";
import { getWorkspaceProvider } from "@/server/cloud/workspace/providers";
import { getGitProvider } from "@/server/cloud/git/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const workspace = getWorkspaceProvider();
const git = getGitProvider();

/**
 * GET /api/admin/cloud/deployments?projectId=...
 * Deployment history. Read-only: super_admin identity.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const ctx = await requireAdminIdentity();
    const projectId = url.searchParams.get("projectId") ?? undefined;
    const deployments = await listDeployments(ctx.service, projectId);
    return NextResponse.json({ deployments });
  } catch (err) {
    return toApiError(err);
  }
}

/**
 * POST /api/admin/cloud/deployments  { projectId, kind, branch? }
 * Creates a REAL deployment through the configured deployment provider. The
 * status/URL come only from the provider's response (never fabricated). When
 * the provider is not configured this returns an honest 503. Re-auth required.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin();
    const body = await readJsonBody<unknown>(request);
    const parsed = cloudDeploySchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).message);

    const project = await getProjectOrThrow(ctx.service, parsed.data.projectId);
    assertProjectActive(project);

    const provider = getDeploymentProvider();
    if (!provider.status().configured) {
      throw new ValidationError(
        "The deployment provider is not configured (VERCEL_TOKEN / VERCEL_PROJECT_ID). Deployments are disabled."
      );
    }

    const root = workspace.resolveRoot(project.id);
    const { head, branch } = await git.currentBranch(root);
    const deploymentRow = await createDeploymentRow(ctx.service, {
      projectId: project.id,
      kind: parsed.data.kind,
      ref: head,
      branch,
      initiatedBy: ctx.user.id,
    });

    try {
      const created = await provider.createDeployment({
        projectId: project.id,
        ref: head,
        branch,
        workspaceRoot: root,
        kind: parsed.data.kind,
      });
      await syncDeploymentResult(ctx.service, deploymentRow.id, {
        status: created.status,
        url: created.url,
      });
      await logAdminAction(ctx.service, {
        actorId: ctx.user.id,
        action: "admin.cloud.deployment.create",
        resourceType: "cloud_deployment",
        resourceId: deploymentRow.id,
        success: true,
        metadata: {
          project: project.slug,
          kind: parsed.data.kind,
          ref: head,
          requestId: created.requestId,
        },
      });
      await touchProject(ctx.service, project.id, {
        lastDeploymentStatus: created.status === "ready" ? "ready" : created.status === "failed" ? "failed" : "building",
      });
      return NextResponse.json(
        {
          deployment: {
            id: deploymentRow.id,
            status: created.status,
            url: created.url,
            requestId: created.requestId,
          },
        },
        { status: 201 }
      );
    } catch (err) {
      await syncDeploymentResult(ctx.service, deploymentRow.id, { status: "failed" });
      throw err;
    }
  } catch (err) {
    return toApiError(err);
  }
}