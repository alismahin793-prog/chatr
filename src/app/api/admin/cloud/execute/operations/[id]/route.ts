import { NextResponse } from "next/server";
import { requireAdminIdentity } from "@/server/admin/security";
import { toApiError } from "@/server/api/helpers";
import { getOperation } from "@/server/cloud/service";
import { getExecutionProvider } from "@/server/cloud/execution/providers";
import { finalizeOperation } from "@/server/cloud/execution/finalize";
import { uuidParam } from "@/app/api/admin/cloud/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/cloud/execute/operations/:id
 * Returns the persisted operation row plus the live provider snapshot if the
 * process is still queryable. Read-only: super_admin identity.
 */
export async function GET(request: Request, params: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params.params;
    const opId = uuidParam(id, "operation id");
    const ctx = await requireAdminIdentity();
    const provider = getExecutionProvider();

    let operation = await getOperation(ctx.service, opId);

    // Reconcile: if the stored row still says running but the provider reached
    // a terminal state, persist the real result before returning it.
    if (
      provider.status().configured &&
      (operation.status === "running" || operation.status === "queued")
    ) {
      try {
        const snapshot = provider.poll(opId, 0).snapshot;
        if (snapshot.state !== "running") {
          const chunks = provider.poll(opId, -1).newOutput;
          await finalizeOperation(
            ctx.service,
            opId,
            { state: snapshot.state, exitCode: snapshot.exitCode },
            chunks
          );
          operation = await getOperation(ctx.service, opId);
        }
      } catch {
        // unknown to this runtime (worker-only) — leave as-is
      }
    }

    let process: import("@/server/cloud/types").ProcessSnapshot | null = null;
    if (provider.status().configured) {
      try {
        process = provider.poll(opId, 0).snapshot;
      } catch {
        process = null; // no persistent runtime for this op (e.g. worker).
      }
    }

    return NextResponse.json({ operation, process });
  } catch (err) {
    return toApiError(err);
  }
}