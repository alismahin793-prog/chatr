import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { supabaseErrorToAppError } from "@/server/data/errors";

/**
 * Aggregate statistics for the Admin dashboard. All queries run through the
 * service role. Counts use PostgREST head-only exact counts; time-series rows
 * are aggregated in JS (fine at dashboard scale).
 */

export interface AdminStats {
  users: number;
  usersPending: number;
  usersApproved: number;
  usersRejected: number;
  usersDisabled: number;
  conversations: number;
  messages: number;
  aiRequests: number;
  aiRequestsToday: number;
  featuresEnabled: number;
  featuresTotal: number;
  proposalsOpen: number;
  failedActionsRecent: number;
}

export interface RecentActivityEntry {
  id: string;
  action: string;
  actorId: string | null;
  resourceType: string | null;
  success: boolean;
  createdAt: string;
}

async function countAll(
  service: SupabaseClient<Database>,
  table:
    | "profiles"
    | "conversations"
    | "messages"
    | "features"
    | "improvement_proposals"
    | "ai_request_log"
    | "audit_log"
): Promise<number> {
  const { count, error } = await service
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) throw supabaseErrorToAppError(error);
  return count ?? 0;
}

export async function getAdminStats(
  service: SupabaseClient<Database>
): Promise<AdminStats> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const countByStatus = async (
    status: Database["public"]["Tables"]["profiles"]["Row"]["status"]
  ): Promise<number> => {
    const { count, error } = await service
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("status", status);
    if (error) throw supabaseErrorToAppError(error);
    return count ?? 0;
  };

  const [users, conversations, messages, featuresTotal, proposalsOpen] =
    await Promise.all([
      countAll(service, "profiles"),
      countAll(service, "conversations"),
      countAll(service, "messages"),
      countAll(service, "features"),
      countAll(service, "improvement_proposals"),
    ]);

  const [usersPending, usersApproved, usersRejected, usersDisabled] =
    await Promise.all([
      countByStatus("pending"),
      countByStatus("approved"),
      countByStatus("rejected"),
      countByStatus("disabled"),
    ]);

  const { count: featuresEnabled, error: featuresError } = await service
    .from("features")
    .select("*", { count: "exact", head: true })
    .eq("enabled", true);
  if (featuresError) throw supabaseErrorToAppError(featuresError);

  const { count: aiRequests, error: aiError } = await service
    .from("ai_request_log")
    .select("*", { count: "exact", head: true });
  if (aiError) throw supabaseErrorToAppError(aiError);

  const { count: aiRequestsToday, error: aiTodayError } = await service
    .from("ai_request_log")
    .select("*", { count: "exact", head: true })
    .gte("created_at", todayStart.toISOString());
  if (aiTodayError) throw supabaseErrorToAppError(aiTodayError);

  const { count: failedActionsRecent, error: failedError } = await service
    .from("audit_log")
    .select("*", { count: "exact", head: true })
    .eq("success", false);
  if (failedError) throw supabaseErrorToAppError(failedError);

  return {
    users,
    usersPending,
    usersApproved,
    usersRejected,
    usersDisabled,
    conversations,
    messages,
    aiRequests: aiRequests ?? 0,
    aiRequestsToday: aiRequestsToday ?? 0,
    featuresEnabled: featuresEnabled ?? 0,
    featuresTotal,
    proposalsOpen: proposalsOpen ?? 0,
    failedActionsRecent: failedActionsRecent ?? 0,
  };
}

/** Most recent audit-log actions, newest first. */
export async function getRecentActivity(
  service: SupabaseClient<Database>,
  limit = 12
): Promise<RecentActivityEntry[]> {
  const { data, error } = await service
    .from("audit_log")
    .select("id, action, actor_id, resource_type, success, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw supabaseErrorToAppError(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    action: row.action,
    actorId: row.actor_id,
    resourceType: row.resource_type,
    success: row.success,
    createdAt: row.created_at,
  }));
}