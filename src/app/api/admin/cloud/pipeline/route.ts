import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin/security";
import { logAdminAction } from "@/server/admin/audit";
import { readJsonBody, toApiError } from "@/server/api/helpers";
import { cloudPipelineSchema, formatZodError } from "@/server/validation/schemas";
import { ValidationError } from "@/server/errors";
import {
  assertProjectActive,
  createOperation,
  getProjectOrThrow,
} from "@/server/cloud/service";
import { getExecutionProvider } from "@/server/cloud/execution/providers";
import { finalizeOperation } from "@/server/cloud/execution/finalize";
import { getWorkspaceProvider } from "@/server/cloud/workspace/providers";
import { CLOUD_PIPELINE_STEPS } from "@/server/cloud/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const workspace = getWorkspaceProvider();

/**
 * POST /api/admin/cloud/pipeline  { projectId, step }
 * Runs one approved pipeline step (install / lint / typecheck / test / gate /
 * build) through the execution provider. Steps come from the static catalogue
 * — the client can never inject arbitrary commands here. Re-auth required.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin();
    const body = await readJsonBody<unknown>(request);
    const parsed = cloudPipelineSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).message);

    const step = CLOUD_PIPELINE_STEPS.find((s) => s.key === parsed.data.step);
    if (!step) throw new ValidationError("Unknown pipeline step.");

    const project = await getProjectOrThrow(ctx.service, parsed.data.projectId);
    assertProjectActive(project);

    const provider = getExecutionProvider();
    const providerStatus = provider.status();
    if (!providerStatus.configured) {
      throw new ValidationError(providerStatus.reason);
    }

    const root = workspace.resolveRoot(project.id);
    // The root is already an absolute directory locally and the project-id
    // handle remotely; the workers (local + remote) resolve it identically.
    const workingDir = root;

    const operation = await createOperation(ctx.service, {
      projectId: project.id,
      kind: step.key === "build" ? "build" : step.key === "test" ? "test" : step.key === "install" ? "install" : step.key === "lint" ? "lint" : step.key === "typecheck" ? "typecheck" : "command",
      program: step.program,
      args: step.args,
      workingDir,
      adminId: ctx.user.id,
    });

    const snapshot = await provider.run({
      id: operation.id,
      program: step.program,
      args: step.args,
      cwd: workingDir,
      timeoutMs: step.timeoutMs,
      maxOutputBytes: step.maxOutputBytes,
    });

    // A provider that already resolved to a terminal state (e.g. immediate
    // spawn error) must not leave a phantom "running" row in the database.
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

    await logAdminAction(ctx.service, {
      actorId: ctx.user.id,
      action: `admin.cloud.pipeline.${step.key}`,
      resourceType: "cloud_operation",
      resourceId: operation.id,
      success: true,
      metadata: { project: project.slug, program: step.program, command: `npm ${step.args.join(" ")}` },
    });

    return NextResponse.json({
      operationId: operation.id,
      step: step.key,
      process: { state: snapshot.state, exitCode: snapshot.exitCode },
    });
  } catch (err) {
    return toApiError(err);
  }
}