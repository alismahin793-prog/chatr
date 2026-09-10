import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { supabaseErrorToAppError } from "@/server/data/errors";
import { getAdminStats } from "@/server/admin/stats";

/**
 * System health + error reporting for the Admin "System" section. Health is
 * derived from database reachability and recent activity — there are no
 * standalone backend services to ping, and we deliberately do not surface
 * secrets, keys, or environment variable values.
 */

export interface SystemHealth {
  status: "ok" | "degraded";
  database: "ok" | "unreachable";
  timestamp: string;
  stats: {
    users: number;
    conversations: number;
    messages: number;
  };
}

export interface SystemErrorEntry {
  id: string;
  action: string;
  actorId: string | null;
  resourceType: string | null;
  message: string;
  createdAt: string;
}

/** Checks live database connectivity and returns aggregate counters. */
export async function getSystemHealth(
  service: SupabaseClient<Database>
): Promise<SystemHealth> {
  try {
    const stats = await getAdminStats(service);
    return {
      status: "ok",
      database: "ok",
      timestamp: new Date().toISOString(),
      stats: {
        users: stats.users,
        conversations: stats.conversations,
        messages: stats.messages,
      },
    };
  } catch (err) {
    console.error("System health check failed.", err);
    return {
      status: "degraded",
      database: "unreachable",
      timestamp: new Date().toISOString(),
      stats: { users: 0, conversations: 0, messages: 0 },
    };
  }
}

/** Failed actions from the audit log (success = false), newest first. */
export async function getSystemErrors(
  service: SupabaseClient<Database>,
  limit = 50
): Promise<SystemErrorEntry[]> {
  const { data, error } = await service
    .from("audit_log")
    .select("id, action, actor_id, resource_type, metadata, created_at")
    .eq("success", false)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw supabaseErrorToAppError(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    action: row.action,
    actorId: row.actor_id,
    resourceType: row.resource_type,
    message:
      row.metadata && typeof row.metadata === "object" && "error" in row.metadata
        ? String((row.metadata as { error: unknown }).error)
        : "Unknown error",
    createdAt: row.created_at,
  }));
}