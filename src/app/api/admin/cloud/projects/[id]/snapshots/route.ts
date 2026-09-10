import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { requireAdmin, requireAdminIdentity } from "@/server/admin/security";
import { logAdminAction } from "@/server/admin/audit";
import { readJsonBody, toApiError } from "@/server/api/helpers";
import { cloudSnapshotCreateSchema, formatZodError } from "@/server/validation/schemas";
import { ValidationError } from "@/server/errors";
import {
  assertProjectActive,
  getProjectOrThrow,
  createSnapshotRow,
  listSnapshots,
  type CloudProjectRow,
} from "@/server/cloud/service";
import { getWorkspaceProvider } from "@/server/cloud/workspace/providers";
import { getGitProvider } from "@/server/cloud/git/providers";
import { uuidParam } from "@/app/api/admin/cloud/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const git = getGitProvider();
const workspace = getWorkspaceProvider();

async function resolveProject(
  ctx: { params: Promise<{ id: string }> },
  service: SupabaseClient<Database>
): Promise<{ projectId: string; project: CloudProjectRow }> {
  const { id } = await ctx.params;
  const projectId = uuidParam(id, "project id");
  const project = await getProjectOrThrow(service, projectId);
  return { projectId, project };
}

/**
 * GET /api/admin/cloud/projects/:id/snapshots
 * Snapshot history for a project. Read-only: super_admin identity.
 */
export async function GET(request: Request, params: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAdminIdentity();
    const { projectId } = await resolveProject(params, ctx.service);
    const snapshots = await listSnapshots(ctx.service, projectId);
    return NextResponse.json({ snapshots });
  } catch (err) {
    return toApiError(err);
  }
}

/**
 * POST /api/admin/cloud/projects/:id/snapshots  { reason }
 * Records a git point-in-time snapshot (the current HEAD commit). Snapshots do
 * not rewrite history — they record a restorable ref and are created before
 * high-risk changes. Re-auth required.
 */
export async function POST(request: Request, params: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAdmin();
    const { projectId, project } = await resolveProject(params, ctx.service);
    assertProjectActive(project);
    const body = await readJsonBody<unknown>(request);
    const parsed = cloudSnapshotCreateSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).message);

    const root = workspace.resolveRoot(projectId);
    const { branch, head } = await git.currentBranch(root);
    const snapshot = await createSnapshotRow(ctx.service, {
      projectId,
      reason: parsed.data.reason,
      ref: head,
      createdBy: ctx.user.id,
    });

    await logAdminAction(ctx.service, {
      actorId: ctx.user.id,
      action: "admin.cloud.snapshot.create",
      resourceType: "cloud_snapshot",
      resourceId: snapshot.id,
      success: true,
      metadata: { project: project.slug, branch, ref: head, reason: parsed.data.reason },
    });
    return NextResponse.json({ snapshot }, { status: 201 });
  } catch (err) {
    return toApiError(err);
  }
}