import { NextResponse } from "next/server";
import { requireAdmin, requireAdminIdentity } from "@/server/admin/security";
import { logAdminAction } from "@/server/admin/audit";
import { readJsonBody, toApiError } from "@/server/api/helpers";
import { cloudExecuteSchema, formatZodError } from "@/server/validation/schemas";
import { ValidationError } from "@/server/errors";
import {
  assertProjectActive,
  createOperation,
  getProjectOrThrow,
  listOperations,
  touchProject,
  type CloudOperationKind,
} from "@/server/cloud/service";
import { assertSafeCommand, parseCommandLine } from "@/server/cloud/execution/CommandSecurity";
import { getExecutionProvider } from "@/server/cloud/execution/providers";
import { finalizeOperation } from "@/server/cloud/execution/finalize";
import { getWorkspaceProvider } from "@/server/cloud/workspace/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 512 * 1024;

/**
 * POST /api/admin/cloud/execute
 * Validates a terminal command against the allowlist, then runs it in the
 * project workspace through the configured execution provider. The operation
 * is audited and its truncated output head is persisted.
 *
 * Commands never go through a shell. Argument vectors are built server-side
 * and passed to spawn directly. Requires a fresh 30-second re-auth window.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin();
    const body = await readJsonBody<unknown>(request);
    const parsed = cloudExecuteSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).message);

    const project = await getProjectOrThrow(ctx.service, parsed.data.projectId);
    assertProjectActive(project);

    // 1) Validate the command (pure) before touching any provider or DB.
    const tokens = parseCommandLine(parsed.data.command);
    const safe = assertSafeCommand(tokens[0], tokens.slice(1));

    const provider = getExecutionProvider();
    const providerStatus = provider.status();
    if (!providerStatus.configured) {
      throw new ValidationError(providerStatus.reason);
    }

    const root = getWorkspaceProvider().resolveRoot(project.id);
    // The root is already an absolute directory locally and the project-id
    // handle remotely; the workers (local + remote) resolve it identically.
    const workingDir = root;

    const operation = await createOperation(ctx.service, {
      projectId: project.id,
      kind: parsed.data.kind as CloudOperationKind,
      program: safe.program,
      args: safe.args,
      workingDir,
      adminId: ctx.user.id,
    });

    const snapshot = await provider.run({
      id: operation.id,
      program: safe.program,
      args: safe.args,
      cwd: workingDir,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    });

    // If the provider already returned a terminal state (e.g. spawn error),
    // persist the final result now instead of leaving a phantom "running" row.
    if (snapshot.state !== "running") {
      let chunks: { seq: number; kind: "stdout" | "stderr"; text: string }[] = [];
      try {
        chunks = provider.poll(operation.id, -1).newOutput;
      } catch {
        // worker may not keep local output
      }
      await finalizeOperation(
        ctx.service,
        operation.id,
        { state: snapshot.state, exitCode: snapshot.exitCode },
        chunks
      );
    }

    await touchProject(ctx.service, project.id);
    await logAdminAction(ctx.service, {
      actorId: ctx.user.id,
      action: "admin.cloud.execute",
      resourceType: "cloud_operation",
      resourceId: operation.id,
      success: true,
      metadata: {
        project: project.slug,
        program: safe.program,
        args: safe.args,
      },
    });

    return NextResponse.json({
      operationId: operation.id,
      process: {
        state: snapshot.state,
        exitCode: snapshot.exitCode,
        startedAt: snapshot.startedAt,
      },
    });
  } catch (err) {
    return toApiError(err);
  }
}

/**
 * GET /api/admin/cloud/execute/operations?projectId=...
 * Operation history for a project (or across all projects when omitted).
 * Read-only: super_admin identity. Matching provider rows that finished while
 * no SSE stream was connected are finalized here so history stays honest.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireAdminIdentity();
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const provider = getExecutionProvider();
    const operations = await reconcileAndList(ctx.service, provider, projectId ?? undefined);
    return NextResponse.json({ operations });
  } catch (err) {
    return toApiError(err);
  }
}

/**
 * Lists operations, finalizing any that are still marked running but whose
 * provider process has already reached a terminal state (e.g. the client
 * never opened the SSE stream). Best-effort: a write failure never breaks
 * the list.
 */
async function reconcileAndList(
  service: Parameters<typeof listOperations>[0],
  provider: ReturnType<typeof getExecutionProvider>,
  projectId?: string
): Promise<Awaited<ReturnType<typeof listOperations>>> {
  const operations = await listOperations(service, projectId, 60);
  if (!provider.status().configured) return operations;
  for (const op of operations) {
    if (op.status !== "running" && op.status !== "queued") continue;
    try {
      const result = provider.poll(op.id, 0);
      if (result.snapshot.state === "running") continue;
      const chunks = provider.poll(op.id, -1).newOutput;
      await finalizeOperation(
        service,
        op.id,
        { state: result.snapshot.state, exitCode: result.snapshot.exitCode },
        chunks
      );
    } catch {
      // unknown to this runtime (worker-only) — leave as-is
    }
  }
  return listOperations(service, projectId, 60);
}