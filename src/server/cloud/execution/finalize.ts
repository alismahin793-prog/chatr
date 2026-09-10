import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { finishOperation, getOperation, type CloudOperationStatus } from "@/server/cloud/service";
import { buildOutputHead } from "@/server/cloud/output";
import type { OutputChunk } from "@/server/cloud/types";

/**
 * Finalization bookkeeping for Cloud Development operations. The execution
 * provider holds live output; this is the ONLY place a final status, exit
 * code, and bounded (redacted) output head is computed and persisted.
 */

export type TerminalSnapshot = {
  state: string;
  exitCode: number | null;
  durationMs?: number | null;
};

/** Maps an execution provider terminal state to a stored operation status. */
export function storedStatusFor(snapshot: TerminalSnapshot): CloudOperationStatus {
  const code = snapshot.exitCode ?? null;
  if (snapshot.state === "timed_out") return "timed_out";
  if (snapshot.state === "cancelled") return "cancelled";
  if (snapshot.state === "error") return "failed";
  return code === 0 ? "completed" : "failed";
}

export function isTerminalState(state: string): boolean {
  return state !== "running";
}

/** Joins provider output chunks into one text blob (secrets still present). */
export function outputTextOf(chunks: OutputChunk[]): string {
  return chunks
    .map((chunk) => chunk.text)
    .join("")
    .replace(/\u0000/g, "")
    .trim();
}

/**
 * Persists the terminal result of an operation: mapped status, exit code,
 * duration, and a bounded + secret-redacted output head. Refuses to touch an
 * operation that is no longer running/queued, so repeated calls are idempotent.
 */
export async function finalizeOperation(
  service: SupabaseClient<Database>,
  opId: string,
  snapshot: TerminalSnapshot,
  outputChunks?: OutputChunk[]
): Promise<void> {
  const operation = await getOperation(service, opId);
  if (operation.status !== "running" && operation.status !== "queued") return;

  const { head, truncated } = buildOutputHead(outputTextOf(outputChunks ?? []));
  const durationMs =
    snapshot.durationMs ?? (operation.started_at ? Date.now() - Date.parse(operation.started_at) : null);

  await finishOperation(service, opId, {
    status: storedStatusFor(snapshot),
    exitCode: snapshot.exitCode,
    durationMs,
    outputHead: head,
    outputTruncated: truncated,
  });
}