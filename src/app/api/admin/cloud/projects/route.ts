import { NextResponse } from "next/server";
import { requireAdmin, requireAdminIdentity } from "@/server/admin/security";
import { logAdminAction } from "@/server/admin/audit";
import { readJsonBody, toApiError } from "@/server/api/helpers";
import {
  cloudCreateProjectSchema,
  formatZodError,
} from "@/server/validation/schemas";
import { ValidationError } from "@/server/errors";
import { createProject, listProjects, type CloudProjectRow } from "@/server/cloud/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/cloud/projects
 * Lists cloud projects (newest first). Read-only: super_admin identity.
 */
export async function GET() {
  try {
    const ctx = await requireAdminIdentity();
    const projects = await listProjects(ctx.service);
    return NextResponse.json({ projects: projects.map(allowedSerializableProject) });
  } catch (err) {
    return toApiError(err);
  }
}

export interface SerializableCloudProject {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: string;
  repoUrl: string | null;
  defaultBranch: string;
  baseEnv: string;
  lastBuildStatus: string;
  lastDeploymentStatus: string;
  envVarNames: string[];
  envVarCount: number;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export function allowedSerializableProject(p: CloudProjectRow): SerializableCloudProject {
  const envVarNames = Array.isArray(p.env_vars)
    ? (p.env_vars as unknown as { name: string }[]).map((e) => e.name)
    : [];
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    status: p.status,
    repoUrl: p.repo_url,
    defaultBranch: p.default_branch,
    baseEnv: p.base_env,
    lastBuildStatus: p.last_build_status,
    lastDeploymentStatus: p.last_deployment_status,
    envVarNames,
    envVarCount: envVarNames.length,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    lastActivityAt: p.last_activity_at,
  };
}

/**
 * POST /api/admin/cloud/projects
 * Creates a cloud project (its workspace is materialized lazily on first use).
 * Sensitive: requires a fresh 30-second re-auth window.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin();
    const body = await readJsonBody<unknown>(request);
    const parsed = cloudCreateProjectSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(formatZodError(parsed.error).message);
    }
    const project = await createProject(ctx.service, parsed.data);
    await logAdminAction(ctx.service, {
      actorId: ctx.user.id,
      action: "admin.cloud.project.create",
      resourceType: "cloud_project",
      resourceId: project.id,
      success: true,
      metadata: {
        name: project.name,
        slug: project.slug,
        repository: project.repo_url ?? undefined,
      },
    });
    return NextResponse.json({ project: allowedSerializableProject(project) }, { status: 201 });
  } catch (err) {
    return toApiError(err);
  }
}