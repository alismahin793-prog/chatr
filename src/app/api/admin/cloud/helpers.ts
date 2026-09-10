import "server-only";
import { ValidationError } from "@/server/errors";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getProjectOrThrow, type CloudProjectRow } from "@/server/cloud/service";

/** Validates a uuid query/route param for cloud resources. */
export function uuidParam(value: string | null, label = "id"): string {
  const parsed = z.string().uuid(`Invalid ${label}.`).safeParse(value);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message);
  return parsed.data;
}

/** Reads a validated projectId from a GET query and returns the project row. */
export async function projectFromQuery(
  service: SupabaseClient<Database>,
  url: URL,
  label = "projectId"
): Promise<{ projectId: string; project: CloudProjectRow }> {
  const projectId = uuidParam(url.searchParams.get(label), label);
  const project = await getProjectOrThrow(service, projectId);
  return { projectId, project };
}

/** Truncates a raw output blob for storage, refusing to store credential text. */
export function outputHeadForStore(text: string, max = 4000): { head: string; truncated: boolean } {
  const fixed = text.replace(/\u0000/g, "").trim();
  const truncated = fixed.length > max;
  return { head: truncated ? fixed.slice(0, max) : fixed, truncated };
}