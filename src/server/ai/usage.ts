import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { supabaseErrorToAppError } from "@/server/data/errors";

/**
 * AI request telemetry. The chat route records one row per completed request
 * (fire-and-forget) so the Admin dashboard can show usage without reading raw
 * conversation content. No message content or keys are ever stored.
 */

export interface AiUsageStats {
  total: number;
  today: number;
  byProvider: Record<string, number>;
  byModel: Record<string, number>;
  last7Days: { date: string; count: number }[];
}

/**
 * Records a completed AI request. Deliberately never throws: a telemetry
 * failure must not break the user's chat response.
 */
export async function recordAiRequest(
  service: SupabaseClient<Database>,
  input: {
    userId: string;
    conversationId?: string | null;
    provider: string;
    model: string;
  }
): Promise<void> {
  try {
    await service.from("ai_request_log").insert({
      user_id: input.userId,
      conversation_id: input.conversationId ?? null,
      provider: input.provider,
      model: input.model,
    });
  } catch (err) {
    console.error("AI request telemetry write failed.", err);
  }
}

/** Aggregates AI usage for the Admin "AI & Usage" section. */
export async function getAiUsageStats(
  service: SupabaseClient<Database>
): Promise<AiUsageStats> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count: total, error: totalError } = await service
    .from("ai_request_log")
    .select("*", { count: "exact", head: true });
  if (totalError) throw supabaseErrorToAppError(totalError);

  const { count: today, error: todayError } = await service
    .from("ai_request_log")
    .select("*", { count: "exact", head: true })
    .gte("created_at", todayStart.toISOString());
  if (todayError) throw supabaseErrorToAppError(todayError);

  const since = new Date();
  since.setDate(since.getDate() - 6);
  since.setHours(0, 0, 0, 0);

  const { data: rows, error: rowsError } = await service
    .from("ai_request_log")
    .select("provider, model, created_at")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false });
  if (rowsError) throw supabaseErrorToAppError(rowsError);

  const byProvider: Record<string, number> = {};
  const byModel: Record<string, number> = {};
  const dayCounts = new Map<string, number>();

  for (const row of rows ?? []) {
    byProvider[row.provider] = (byProvider[row.provider] ?? 0) + 1;
    byModel[row.model] = (byModel[row.model] ?? 0) + 1;
    const day = row.created_at.slice(0, 10);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }

  const last7Days: { date: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    last7Days.push({ date, count: dayCounts.get(date) ?? 0 });
  }

  return {
    total: total ?? 0,
    today: today ?? 0,
    byProvider,
    byModel,
    last7Days,
  };
}

export interface AiRequestLogRow {
  id: string;
  userId: string;
  userEmail: string | null;
  conversationId: string | null;
  provider: string;
  model: string;
  createdAt: string;
}

/**
 * Lists the most recent AI request log entries for the Admin "AI Request Logs"
 * section. Runs on the service role so admins always see every request; email
 * is resolved from the Auth directory (no message content is available, and
 * never will be — the logs only ever store metadata).
 */
export async function listAiRequestLogs(
  service: SupabaseClient<Database>,
  limit = 100
): Promise<AiRequestLogRow[]> {
  const { data: rows, error } = await service
    .from("ai_request_log")
    .select("id, user_id, conversation_id, provider, model, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw supabaseErrorToAppError(error);

  const userIds = Array.from(new Set((rows ?? []).map((row) => row.user_id)));
  const emailById: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: authUsers, error: authError } = await service.auth.admin.listUsers();
    if (authError) throw supabaseErrorToAppError(authError);
    for (const user of authUsers?.users ?? []) {
      if (user.email) emailById[user.id] = user.email;
    }
  }

  return (rows ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    userEmail: emailById[row.user_id] ?? null,
    conversationId: row.conversation_id,
    provider: row.provider,
    model: row.model,
    createdAt: row.created_at,
  }));
}