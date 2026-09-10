import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin/security";
import { logAdminAction } from "@/server/admin/audit";
import { readJsonBody, toApiError } from "@/server/api/helpers";
import { formatZodError } from "@/server/validation/schemas";
import { z } from "zod";
import { AppError, ValidationError } from "@/server/errors";
import {
  assertProjectActive,
  getProjectOrThrow,
  setSnapshotStatus,
  getSnapshotOrThrow,
} from "@/server/cloud/service";
import { getWorkspaceProvider } from "@/server/cloud/workspace/providers";
import { getGitProvider } from "@/server/cloud/git/providers";
import { uuidParam } from "@/app/api/admin/cloud/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const git = getGitProvider();
const workspace = getWorkspaceProvider();

/**
 * POST /api/admin/cloud/projects/:id/snapshots/:sid/restore  { confirm: true }
 * Restores the workspace files to a snapshot commit. Requires a clean working
 * tree (so no work is silently lost) and explicit confirmation. After a
 * restore you re-run the pipeline and redeploy — nothing is deployed or
 * pushed automatically. Re-auth window required.
 */
export async function POST(request: Request, params: { params: Promise<{ id: string; sid: string }> }) {
  try {
    const { id, sid } = await params.params;
    const projectId = uuidParam(id, "project id");
    const snapshotId = uuidParam(sid, "snapshot id");
    const ctx = await requireAdmin();

    const project = await getProjectOrThrow(ctx.service, projectId);
    assertProjectActive(project);
    const snapshot = await getSnapshotOrThrow(ctx.service, snapshotId);

    const body = await readJsonBody<unknown>(request);
    const parsed = z.object({ confirm: z.literal(true) }).safeParse(body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).message);

    if (snapshot.project_id !== projectId) {
      throw new AppError("forbidden", "Snapshot does not belong to this project.", 403);
    }

    const root = workspace.resolveRoot(projectId);
    await setSnapshotStatus(ctx.service, snapshotId, "restoring");
    try {
      await git.checkout(root, snapshot.ref); // refuses to run on a dirty tree
    } catch (err) {
      await setSnapshotStatus(ctx.service, snapshotId, "failed");
      throw err;
    }
    await setSnapshotStatus(ctx.service, snapshotId, "restored", new Date().toISOString());

    await logAdminAction(ctx.service, {
      actorId: ctx.user.id,
      action: "admin.cloud.snapshot.restore",
      resourceType: "cloud_snapshot",
      resourceId: snapshotId,
      success: true,
      metadata: {
        project: project.slug,
        ref: snapshot.ref,
        reason: snapshot.reason,
      },
    });
    return NextResponse.json({ ok: true, ref: snapshot.ref });
  } catch (err) {
    return toApiError(err);
  }
}