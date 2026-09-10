import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, requireAdminIdentity } from "@/server/admin/security";
import { logAdminAction } from "@/server/admin/audit";
import { readJsonBody, toApiError } from "@/server/api/helpers";
import {
  cloudCreateDirSchema,
  cloudFileRenameSchema,
  cloudFileWriteSchema,
  formatZodError,
} from "@/server/validation/schemas";
import { ValidationError } from "@/server/errors";
import {
  assertProjectActive,
  getProjectOrThrow,
  type CloudProjectRow,
} from "@/server/cloud/service";
import { getWorkspaceProvider } from "@/server/cloud/workspace/providers";
import { uuidParam, projectFromQuery } from "@/app/api/admin/cloud/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const workspace = getWorkspaceProvider();

function pathQueryParam(url: URL, fallback = "."): string {
  const raw = url.searchParams.get("path") ?? fallback;
  if (typeof raw !== "string" || raw.length > 1024) throw new ValidationError("Invalid path.");
  return raw;
}

/**
 * GET /api/admin/cloud/files?projectId=...&mode=read&path=src/x.ts
 *    mode read   → file content (text only, sensitive paths denied)
 *    mode search → q=<query> name search
 *    mode list   → directory listing (default)
 * Read-only: super_admin identity.
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const ctx = await requireAdminIdentity();
    const { projectId, project } = await projectFromQuery(ctx.service, url);
    assertProjectActive(project);

    const mode = url.searchParams.get("mode") ?? "list";
    const root = workspace.resolveRoot(projectId);

    if (mode === "read") {
      const file = await workspace.readFile(root, pathQueryParam(url));
      return NextResponse.json({ file });
    }
    if (mode === "search") {
      const q = (url.searchParams.get("q") ?? "").trim();
      if (!q || q.length > 120) throw new ValidationError("Query is required (max 120 characters).");
      const entries = await workspace.search(root, q);
      return NextResponse.json({ entries });
    }
    if (mode === "list") {
      const entries = await workspace.listDir(root, pathQueryParam(url));
      return NextResponse.json({ entries });
    }
    throw new ValidationError("Unknown mode. Use list, read, or search.");
  } catch (err) {
    return toApiError(err);
  }
}

function auditFile(
  ctx: { service: Parameters<typeof logAdminAction>[0]; user: { id: string } },
  project: CloudProjectRow,
  action: string,
  metadata: Record<string, unknown>
): Promise<void> {
  return logAdminAction(ctx.service, {
    actorId: ctx.user.id,
    action,
    resourceType: "cloud_file",
    success: true,
    metadata: { project: project.slug, ...metadata },
  }).then(() => undefined);
}

/**
 * PUT /api/admin/cloud/files?projectId=...  { path, content }
 * Writes a text file. Sensitive paths are refused. Re-auth required.
 */
export async function PUT(request: NextRequest) {
  try {
    const ctx = await requireAdmin();
    const url = new URL(request.url);
    const projectId = uuidParam(url.searchParams.get("projectId"));
    const body = await readJsonBody<unknown>(request);
    const parsed = cloudFileWriteSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).message);

    const project = await getProjectOrThrow(ctx.service, projectId);
    assertProjectActive(project);
    const result = await workspace.writeFile(workspace.resolveRoot(projectId), parsed.data.path, parsed.data.content);
    await auditFile(ctx, project, "admin.cloud.file.write", { path: result.path, size: result.size });
    return NextResponse.json({ file: result });
  } catch (err) {
    return toApiError(err);
  }
}

/**
 * POST /api/admin/cloud/files?projectId=...  { path }  → create directory.
 * Re-auth required.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAdmin();
    const url = new URL(request.url);
    const projectId = uuidParam(url.searchParams.get("projectId"));
    const body = await readJsonBody<unknown>(request);
    const parsed = cloudCreateDirSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).message);

    const project = await getProjectOrThrow(ctx.service, projectId);
    assertProjectActive(project);
    await workspace.createDir(workspace.resolveRoot(projectId), parsed.data.path);
    await auditFile(ctx, project, "admin.cloud.file.mkdir", { path: parsed.data.path });
    return NextResponse.json({ ok: true, path: parsed.data.path });
  } catch (err) {
    return toApiError(err);
  }
}

/**
 * PATCH /api/admin/cloud/files?projectId=...  { from, to }
 * Renames/moves a path. Re-auth required.
 */
export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAdmin();
    const url = new URL(request.url);
    const projectId = uuidParam(url.searchParams.get("projectId"));
    const body = await readJsonBody<unknown>(request);
    const parsed = cloudFileRenameSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).message);

    const project = await getProjectOrThrow(ctx.service, projectId);
    assertProjectActive(project);
    await workspace.renamePath(workspace.resolveRoot(projectId), parsed.data.from, parsed.data.to);
    await auditFile(ctx, project, "admin.cloud.file.rename", { from: parsed.data.from, to: parsed.data.to });
    return NextResponse.json({ ok: true, from: parsed.data.from, to: parsed.data.to });
  } catch (err) {
    return toApiError(err);
  }
}

/**
 * DELETE /api/admin/cloud/files?projectId=...&path=...&recursive=1
 * Deletes a file or (with recursive=1) a directory. Re-auth required.
 */
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireAdmin();
    const url = new URL(request.url);
    const { projectId, project } = await projectFromQuery(ctx.service, url);
    assertProjectActive(project);
    const path_ = pathQueryParam(url);
    const recursive = url.searchParams.get("recursive") === "1";
    await workspace.deletePath(workspace.resolveRoot(projectId), path_, { recursive });
    await auditFile(ctx, project, "admin.cloud.file.delete", { path: path_, recursive });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toApiError(err);
  }
}