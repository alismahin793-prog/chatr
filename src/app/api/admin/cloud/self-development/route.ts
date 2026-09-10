import { NextResponse } from "next/server";
import { requireAdminIdentity } from "@/server/admin/security";
import { requireSensitivePermission, PERMISSIONS } from "@/server/admin/permissions";
import { buildOrchestrator } from "@/server/self-development/providers";
import { SupabaseSelfDevelopmentStore } from "@/server/self-development/store";
import { readJsonBody, toApiError } from "@/server/api/helpers";
import { formatZodError, selfDevelopmentCreateSchema } from "@/server/validation/schemas";
import { ValidationError } from "@/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/cloud/self-development
 * Lists self-development requests (super_admin identity). Read-only.
 */
export async function GET() {
  try {
    const ctx = await requireAdminIdentity();
    const store = new SupabaseSelfDevelopmentStore(ctx.service);
    const requests = await store.listRequests();
    return NextResponse.json({ requests });
  } catch (err) {
    return toApiError(err);
  }
}

/**
 * POST /api/admin/cloud/self-development  { projectId, prompt }
 * Creates a draft request (fresh admin window required). No code is touched;
 * the AI plan and human approval come later.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireSensitivePermission(PERMISSIONS.CREATE_DEV_REQUESTS);
    const body = await readJsonBody<unknown>(request);
    const parsed = selfDevelopmentCreateSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).message);

    const orchestrator = buildOrchestrator(ctx.service, ctx.user.id);
    const view = await orchestrator.createRequest({
      projectId: parsed.data.projectId,
      requestedBy: ctx.user.id,
      prompt: parsed.data.prompt,
    });
    return NextResponse.json({ request: view.request, project: view.project }, { status: 201 });
  } catch (err) {
    return toApiError(err);
  }
}