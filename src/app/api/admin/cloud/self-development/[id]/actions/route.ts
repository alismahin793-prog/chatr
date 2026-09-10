import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin/security";
import { PERMISSIONS, requireSensitivePermission } from "@/server/admin/permissions";
import { buildOrchestrator } from "@/server/self-development/providers";
import { SelfDevelopmentOrchestrator } from "@/server/self-development/orchestrator";
import { readJsonBody, toApiError } from "@/server/api/helpers";
import { formatZodError, selfDevelopmentActionSchema } from "@/server/validation/schemas";
import { ValidationError } from "@/server/errors";
import { uuidParam } from "@/app/api/admin/cloud/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/cloud/self-development/[id]/actions  { action, acknowledgeCritical?, confirm? }
 *
 * Advances the supervised state machine one step. Every action needs a fresh
 * admin re-authentication window (requireAdmin), and the human-only gates
 * additionally need their explicit permission:
 *   start-planning / run / cancel   → requireAdmin
 *   approve-plan / reject-plan      → APPROVE_DEV_PLANS
 *   approve-deploy / rollback       → APPROVE_DEPLOYMENTS
 *
 * No action in this route can move a request across a gate the operator has
 * not approved: the lifecycle (and the deploy safety checklist) enforce it.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const requestId = uuidParam(id, "requestId");

    const body = await readJsonBody<unknown>(request);
    const parsed = selfDevelopmentActionSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).message);
    const { action, acknowledgeCritical, confirm } = parsed.data;

    let ctx: Awaited<ReturnType<typeof requireAdmin>>;
    switch (action) {
      case "approve-plan":
      case "reject-plan":
        ctx = await requireSensitivePermission(PERMISSIONS.APPROVE_DEV_PLANS);
        break;
      case "approve-deploy":
      case "rollback":
        ctx = await requireSensitivePermission(PERMISSIONS.APPROVE_DEPLOYMENTS);
        break;
      default:
        ctx = await requireAdmin();
    }

    const orchestrator = buildOrchestrator(ctx.service, ctx.user.id);
    const view = await runAction(orchestrator, action, requestId, ctx.user.id, {
      acknowledgeCritical,
      confirm,
    });
    return NextResponse.json({ request: view.request, project: view.project });
  } catch (err) {
    return toApiError(err);
  }
}

async function runAction(
  orchestrator: SelfDevelopmentOrchestrator,
  action: string,
  requestId: string,
  actorId: string,
  opts: { acknowledgeCritical: boolean; confirm: boolean }
) {
  switch (action) {
    case "start-planning":
      return orchestrator.startPlanning(requestId);
    case "approve-plan":
      return orchestrator.approvePlan(requestId, actorId, {
        acknowledgeCritical: opts.acknowledgeCritical,
      });
    case "reject-plan":
      return orchestrator.rejectPlan(requestId);
    case "run":
      return orchestrator.runDevelopment(requestId);
    case "approve-deploy":
      return orchestrator.approveDeploy(requestId, actorId, {
        acknowledgeCritical: opts.acknowledgeCritical,
      });
    case "cancel":
      return orchestrator.cancel(requestId);
    case "rollback":
      return orchestrator.rollback(requestId, { confirm: opts.confirm });
    default:
      throw new ValidationError("Unknown action.");
  }
}