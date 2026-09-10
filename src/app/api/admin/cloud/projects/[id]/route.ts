import { NextResponse } from "next/server";
import { requireAdmin, requireAdminIdentity } from "@/server/admin/security";
import { logAdminAction } from "@/server/admin/audit";
import { readJsonBody, toApiError } from "@/server/api/helpers";
import {
  cloudUpdateProjectSchema,
  formatZodError,
  userIdSchema,
} from "@/server/validation/schemas";
import { ValidationError } from "@/server/errors";
import {
  getProjectOrThrow,
  setProjectStatus,
  updateProject,
} from "@/server/cloud/service";
import { allowedSerializableProject } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveId(params: { params: Promise<{ id: string }> }): Promise<string> {
  const { id } = await params.params;
  const parsed = userIdSchema.safeParse({ id });
  if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).message);
  return parsed.data.id;
}

/**
 * GET /api/admin/cloud/projects/:id
 * Project detail (metadata only — file listing goes through /files).
 */
export async function GET(request: Request, params: { params: Promise<{ id: string }> }) {
  try {
    const id = await resolveId(params);
    const ctx = await requireAdminIdentity();
    const project = await getProjectOrThrow(ctx.service, id);
    return NextResponse.json({ project: allowedSerializableProject(project) });
  } catch (err) {
    return toApiError(err);
  }
}

/**
 * PATCH /api/admin/cloud/projects/:id
 * Updates non-sensitive project metadata. Sensitive: re-auth window required.
 */
export async function PATCH(request: Request, params: { params: Promise<{ id: string }> }) {
  try {
    const id = await resolveId(params);
    const ctx = await requireAdmin();
    const body = await readJsonBody<unknown>(request);
    const parsed = cloudUpdateProjectSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).message);

    const project = await updateProject(ctx.service, id, {
      name: parsed.data.name,
      description: parsed.data.description,
      repo_url: parsed.data.repoUrl ?? null,
      default_branch: parsed.data.defaultBranch,
      base_env: parsed.data.baseEnv,
    });
    await logAdminAction(ctx.service, {
      actorId: ctx.user.id,
      action: "admin.cloud.project.update",
      resourceType: "cloud_project",
      resourceId: id,
      success: true,
      metadata: { name: project.name, fields: parsed.data },
    });
    return NextResponse.json({ project: allowedSerializableProject(project) });
  } catch (err) {
    return toApiError(err);
  }
}

/**
 * DELETE /api/admin/cloud/projects/:id
 * Archives a project (soft). A real project delete is intentionally not
 * exposed. Sensitive: re-auth window required.
 */
export async function DELETE(request: Request, params: { params: Promise<{ id: string }> }) {
  try {
    const id = await resolveId(params);
    const ctx = await requireAdmin();
    const project = await setProjectStatus(ctx.service, id, "archived");
    await logAdminAction(ctx.service, {
      actorId: ctx.user.id,
      action: "admin.cloud.project.archive",
      resourceType: "cloud_project",
      resourceId: id,
      success: true,
      metadata: { name: project.name },
    });
    return NextResponse.json({ project: allowedSerializableProject(project) });
  } catch (err) {
    return toApiError(err);
  }
}