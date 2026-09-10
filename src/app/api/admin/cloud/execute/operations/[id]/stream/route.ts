import { requireAdminIdentity } from "@/server/admin/security";
import { toApiError } from "@/server/api/helpers";
import { getExecutionProvider } from "@/server/cloud/execution/providers";
import { finalizeOperation } from "@/server/cloud/execution/finalize";
import { redactSecretContent } from "@/server/cloud/paths";
import { uuidParam } from "@/app/api/admin/cloud/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function sseEvent(event: string, data: unknown, id?: number): Uint8Array {
  const payload = `data: ${JSON.stringify(data)}\n${id !== undefined ? `id: ${id}\n` : ""}event: ${event}\n\n`;
  return encoder.encode(payload);
}

/**
 * GET /api/admin/cloud/execute/operations/:id/stream
 * Server-Sent Events stream of live process output. Emits:
 *   - event "process" (initial snapshot)
 *   - event "output"  ({ seq, kind, text } chunks from the provider)
 *   - event "end"     (final snapshot with exit code/state)
 * Output is streamed from the REAL execution provider; nothing is simulated.
 * Read path: super_admin identity (finalization only updates rows the caller
 * could already read).
 */
export async function GET(request: Request, params: { params: Promise<{ id: string }> }) {
  const { id } = await params.params;
  const opId = uuidParam(id, "operation id");
  try {
    const providerStatus = await ensureStreamAvailable(opId);
    if (!providerStatus.configured) {
      return new Response(`data: ${JSON.stringify({ message: providerStatus.reason })}\nevent: error\n\n`, {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return streamLoop(opId, request.signal);
  } catch (err) {
    return toApiError(err);
  }
}

async function ensureStreamAvailable(opId: string): Promise<{ configured: boolean; reason?: string }> {
  await requireAdminIdentity();
  const provider = getExecutionProvider();
  const providerStatus = provider.status();
  if (!providerStatus.configured) {
    return { configured: false, reason: providerStatus.reason };
  }
  provider.poll(opId, 0); // throws NotFound if the operation is unknown here
  return { configured: true };
}

function streamLoop(opId: string, signal: AbortSignal): Response {
  const provider = getExecutionProvider();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sinceSeq = 0;
      try {
        const first = provider.poll(opId, sinceSeq);
        controller.enqueue(sseEvent("process", first.snapshot, 0));
        if (first.newOutput.length > 0) {
          controller.enqueue(sseEvent("output", redactChunks(first.newOutput), first.newOutput.length));
          sinceSeq = first.newOutput[first.newOutput.length - 1].seq;
        }

        const interval = setInterval(() => {
          try {
            if (signal.aborted) {
              clearInterval(interval);
              controller.close();
              return;
            }
            const result = provider.poll(opId, sinceSeq);
            if (result.newOutput.length > 0) {
              controller.enqueue(
                sseEvent("output", redactChunks(result.newOutput), result.newOutput.length)
              );
              sinceSeq = result.newOutput[result.newOutput.length - 1].seq;
            }
            if (result.snapshot.state !== "running") {
              clearInterval(interval);
              controller.enqueue(sseEvent("end", result.snapshot));
              controller.close();
              void persistFinalResult(opId, result.snapshot);
            }
          } catch (err) {
            clearInterval(interval);
            controller.enqueue(
              sseEvent("error", { message: err instanceof Error ? err.message : "Stream error." })
            );
            controller.close();
          }
        }, 500);
      } catch (err) {
        controller.enqueue(
          sseEvent("error", { message: err instanceof Error ? err.message : "Unable to start stream." })
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}

/** Redacts credential-looking material from output before it is streamed. */
function redactChunks(
  chunks: { seq: number; kind: "stdout" | "stderr"; text: string }[]
): { seq: number; kind: "stdout" | "stderr"; text: string }[] {
  return chunks.map((chunk) => ({ ...chunk, text: redactSecretContent(chunk.text) }));
}

/** Best-effort bookkeeping: persists the final status + bounded, redacted output head. */
async function persistFinalResult(
  opId: string,
  snapshot: { state: string; exitCode: number | null }
): Promise<void> {
  try {
    const identity = await requireAdminIdentity();
    const provider = getExecutionProvider();
    let chunks: { seq: number; kind: "stdout" | "stderr"; text: string }[] = [];
    try {
      chunks = provider.poll(opId, -1).newOutput;
    } catch {
      // remote worker may not keep local output; finalize with the snapshot only
    }
    await finalizeOperation(
      identity.service,
      opId,
      { state: snapshot.state, exitCode: snapshot.exitCode },
      chunks
    );
  } catch {
    // finalization is best-effort; failed runs surface in the operations list
  }
}