import { NextResponse } from "next/server";
import { requireAdmin, requireAdminIdentity } from "@/server/admin/security";
import { logAdminAction } from "@/server/admin/audit";
import { readJsonBody, toApiError } from "@/server/api/helpers";
import { cloudEnvSetSchema, formatZodError } from "@/server/validation/schemas";
import { ValidationError } from "@/server/errors";
import {
  assertProjectActive,
  getProjectOrThrow,
  envVarsOf,
  setEnvVarMetadata,
} from "@/server/cloud/service";
import {
  deploymentCredentialsConfigured,
  vercelEnvClient,
  vercelSetEnvVariable,
} from "@/server/cloud/deploy/providers";
import { projectFromQuery } from "@/app/api/admin/cloud/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/cloud/environments?projectId=...
 * Environment variable METADATA (names + configured status only — values live
 * in the encrypted secrets provider and are never returned). Read-only.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const ctx = await requireAdminIdentity();
    const { project } = await projectFromQuery(ctx.service, url);
    const environment = {
      providerConfigured: deploymentCredentialsConfigured(),
      vars: envVarsOf(project),
    };
    return NextResponse.json({ environment });
  } catch (err) {
    return toApiError(err);
  }
}

/**
 * POST /api/admin/cloud/environments  { projectId, name, value }
 * Pushes a secret to the encrypted secrets provider. The value is used
 * in-flight only; the DB stores { name, configured, updatedAt }. Without
 * provider credentials this returns an honest 503. Re-auth required.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin();
    const body = await readJsonBody<unknown>(request);
    const parsed = cloudEnvSetSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).message);

    const project = await getProjectOrThrow(ctx.service, parsed.data.projectId);
    assertProjectActive(project);

    const client = vercelEnvClient();
    if (!client) {
      throw new ValidationError(
        "The secrets provider is not configured (VERCEL_TOKEN / VERCEL_PROJECT_ID). Environment variables are disabled."
      );
    }

    await vercelSetEnvVariable(
      client.token,
      client.projectId,
      client.orgId,
      parsed.data.name,
      parsed.data.value
    );

    const updated = await setEnvVarMetadata(ctx.service, project.id, parsed.data.name, true);

    await logAdminAction(ctx.service, {
      actorId: ctx.user.id,
      action: "admin.cloud.environment.set",
      resourceType: "cloud_project",
      resourceId: project.id,
      success: true,
      metadata: { project: project.slug, name: parsed.data.name },
    });

    return NextResponse.json({
      ok: true,
      envVar: { name: parsed.data.name, configured: true },
      vars: envVarsOf(updated),
    });
  } catch (err) {
    return toApiError(err);
  }
}