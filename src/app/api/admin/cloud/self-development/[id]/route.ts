import { NextResponse } from "next/server";
import { requireAdminIdentity } from "@/server/admin/security";
import { SupabaseSelfDevelopmentStore } from "@/server/self-development/store";
import { toApiError } from "@/server/api/helpers";
import { uuidParam } from "@/app/api/admin/cloud/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/cloud/self-development/[id]
 * Full detail: the request, its Cloud project, the audited step timeline and
 * the applied (redacted) changes. Super_admin identity only.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAdminIdentity();
    const { id } = await context.params;
    const requestId = uuidParam(id, "requestId");
    const store = new SupabaseSelfDevelopmentStore(ctx.service);
    const view = await store.getRequest(requestId);
    if (!view) {
      return NextResponse.json({ error: "Self-development request not found." }, { status: 404 });
    }
    const [steps, changes] = await Promise.all([
      store.listSteps(requestId),
      store.listChanges(requestId),
    ]);
    return NextResponse.json({ request: view.request, project: view.project, steps, changes });
  } catch (err) {
    return toApiError(err);
  }
}