import { NextResponse } from "next/server";
import { requireAdmin, requireAdminIdentity } from "@/server/admin/security";
import { logAdminAction } from "@/server/admin/audit";
import { readJsonBody, toApiError } from "@/server/api/helpers";
import { cloudGitActionSchema, formatZodError } from "@/server/validation/schemas";
import { ValidationError } from "@/server/errors";
import {
  assertProjectActive,
  getProjectOrThrow,
} from "@/server/cloud/service";
import { getWorkspaceProvider } from "@/server/cloud/workspace/providers";
import { getGitProvider } from "@/server/cloud/git/providers";
import { projectFromQuery } from "@/app/api/admin/cloud/helpers";
import type { GitStatus } from "@/server/cloud/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const git = getGitProvider();
const workspace = getWorkspaceProvider();

/**
 * GET /api/admin/cloud/git?projectId=...&action=status|diff|log|branches[&path=...]
 * Read-only git inspection. Requires super_admin identity.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const ctx = await requireAdminIdentity();
    const { projectId } = await projectFromQuery(ctx.service, url);
    const root = workspace.resolveRoot(projectId);
    const action = url.searchParams.get("action") ?? "status";

    if (action === "status") {
      const status: GitStatus = await git.status(root);
      return NextResponse.json({ status });
    }
    if (action === "diff") {
      const filePath = url.searchParams.get("path") ?? undefined;
      const diff = await git.diff(root, filePath);
      return NextResponse.json({ diff });
    }
    if (action === "log") {
      const log = await git.log(root, 50);
      return NextResponse.json({ log });
    }
    if (action === "branches") {
      const [branches, current] = await Promise.all([
        git.branches(root),
        git.currentBranch(root),
      ]);
      return NextResponse.json({ branches, current });
    }
    throw new ValidationError("Unknown git action.");
  } catch (err) {
    return toApiError(err);
  }
}

/**
 * POST /api/admin/cloud/git  { projectId, action, branch?, message? }
 * Mutating git operations: checkout, create-branch, commit, push, pull.
 * Every mutation is safe by construction (no force, no history rewrite) and
 * audited. Re-auth window required.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin();
    const body = await readJsonBody<unknown>(request);
    const parsed = cloudGitActionSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).message);

    const project = await getProjectOrThrow(ctx.service, parsed.data.projectId);
    assertProjectActive(project);
    const root = workspace.resolveRoot(project.id);
    const statusBefore = await git.status(root);

    let result: Record<string, unknown> = {};
    switch (parsed.data.action) {
      case "init":
        result.status = await git.init(root, parsed.data.defaultBranch ?? "main");
        break;
      case "checkout":
        if (!parsed.data.branch) throw new ValidationError("A branch is required.");
        result.status = await git.checkout(root, parsed.data.branch);
        break;
      case "create-branch":
        if (!parsed.data.branch) throw new ValidationError("A branch name is required.");
        result.status = await git.createBranch(root, parsed.data.branch);
        break;
      case "commit":
        if (!parsed.data.message) throw new ValidationError("A commit message is required.");
        {
          const committed = await git.commit(root, parsed.data.message);
          result = { ref: committed.ref, message: committed.message };
        }
        break;
      case "push": {
        const pushed = await git.push(root);
        result = { ok: pushed.ok, message: pushed.message };
        break;
      }
      case "pull": {
        const pulled = await git.pull(root);
        result = { ok: pulled.ok, message: pulled.message };
        break;
      }
      default:
        throw new ValidationError("Unknown git action.");
    }

    await logAdminAction(ctx.service, {
      actorId: ctx.user.id,
      action: `admin.cloud.git.${parsed.data.action}`,
      resourceType: "cloud_project",
      resourceId: project.id,
      success: true,
      metadata: {
        project: project.slug,
        branch: parsed.data.branch ?? undefined,
        messageHash: parsed.data.message ? String(parsed.data.message.length) : undefined,
        changedFiles: statusBefore.files.length,
      },
    });

    return NextResponse.json({ result });
  } catch (err) {
    return toApiError(err);
  }
}