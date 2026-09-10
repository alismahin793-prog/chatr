import { NextResponse } from "next/server";
import { requireAdmin, requireAdminIdentity } from "@/server/admin/security";
import { logAdminAction } from "@/server/admin/audit";
import { readJsonBody, toApiError } from "@/server/api/helpers";
import { cloudDeploySchema, formatZodError } from "@/server/validation/schemas";
import { ValidationError } from "@/server/errors";
import {
  assertProjectActive,
  getProjectOrThrow,
  listPreviews,
  createPreviewRow,
  syncPreviewResult,
  createDeploymentRow,
  syncDeploymentResult,
} from "@/server/cloud/service";
import { getDeploymentProvider } from "@/server/cloud/deploy/providers";
import { getWorkspaceProvider } from "@/server/cloud/workspace/providers";
import { getGitProvider } from "@/server/cloud/git/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const workspace = getWorkspaceProvider();
const git = getGitProvider();

/**
 * GET /api/admin/cloud/previews?projectId=...
 * Preview deployments. Read-only: super_admin identity.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const ctx = await requireAdminIdentity();
    const projectId = url.searchParams.get("projectId") ?? undefined;
    const previews = await listPreviews(ctx.service, projectId);
    return NextResponse.json({ previews });
  } catch (err) {
    return toApiError(err);
  }
}

/**
 * POST /api/admin/cloud/previews  { projectId, kind: "preview" }
 * Creates a preview deployment through the configured provider and links it to
 * a cloud_previews row. Re-auth required; honest 503 when unconfigured.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin();
    const body = await readJsonBody<unknown>(request);
    const parsed = cloudDeploySchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).message);
    if (parsed.data.kind !== "preview") {
      throw new ValidationError("Preview deployments must use kind=preview.");
    }

    const project = await getProjectOrThrow(ctx.service, parsed.data.projectId);
    assertProjectActive(project);

    const provider = getDeploymentProvider();
    if (!provider.status().configured) {
      throw new ValidationError("The deployment provider is not configured. Previews are disabled.");
    }

    const root = workspace.resolveRoot(project.id);
    const { head, branch } = await git.currentBranch(root);

    const deploymentRow = await createDeploymentRow(ctx.service, {
      projectId: project.id,
      kind: "preview",
      ref: head,
      branch,
      initiatedBy: ctx.user.id,
    });
    const previewRow = await createPreviewRow(ctx.service, {
      projectId: project.id,
      deploymentId: deploymentRow.id,
      commit: head,
    });

    try {
      const created = await provider.createDeployment({
        projectId: project.id,
        ref: head,
        branch,
        workspaceRoot: root,
        kind: "preview",
      });
      await syncDeploymentResult(ctx.service, deploymentRow.id, {
        status: created.status,
        url: created.url,
      });
      await syncPreviewResult(ctx.service, previewRow.id, {
        status: created.status === "ready" ? "ready" : created.status === "failed" ? "failed" : "building",
        url: created.url,
      });
    } catch (err) {
      await syncDeploymentResult(ctx.service, deploymentRow.id, { status: "failed" });
      await syncPreviewResult(ctx.service, previewRow.id, { status: "failed", url: null });
      throw err;
    }

    await logAdminAction(ctx.service, {
      actorId: ctx.user.id,
      action: "admin.cloud.preview.create",
      resourceType: "cloud_preview",
      resourceId: previewRow.id,
      success: true,
      metadata: { project: project.slug, ref: head, branch },
    });

    return NextResponse.json(
      {
        preview: { id: previewRow.id, deploymentId: deploymentRow.id, commit: head },
        deployment: { id: deploymentRow.id, status: "queued" },
      },
      { status: 201 }
    );
  } catch (err) {
    return toApiError(err);
  }
}