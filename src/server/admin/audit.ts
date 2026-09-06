import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { supabaseErrorToAppError } from "@/server/data/errors";

/** Keys whose values are considered secrets and are redacted from logs. */
const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|api[_-]?key|token|authorization|bearer|credential)/i;

/**
 * Recursively redacts the value of any key that looks like a credential
 * (password, token, key, secret, ...). Innocuous values pass through. Callers
 * must still avoid passing secrets under unrelated key names.
 */
export function sanitizeMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMetadata(item));
  }
  if (value !== null && typeof value === "object") {
    const cleaned: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      cleaned[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? "[REDACTED]"
        : sanitizeMetadata(item);
    }
    return cleaned;
  }
  return value;
}

export interface AuditLogEntry {
  /** Who performed the action. */
  actorId: string;
  /** Stable action identifier, e.g. "admin.reauth". */
  action: string;
  /** The kind of resource targeted, when applicable. */
  resourceType?: string;
  /** The specific resource targeted, when applicable. */
  resourceId?: string;
  success?: boolean;
  /** Structured context. Secret-looking values are redacted automatically. */
  metadata?: Record<string, unknown>;
}

/** Writes an audit row through the service role (bypassing tenant RLS). */
export async function insertAuditLog(
  service: SupabaseClient<Database>,
  entry: AuditLogEntry
): Promise<void> {
  const { error } = await service.from("audit_log").insert({
    actor_id: entry.actorId,
    action: entry.action,
    resource_type: entry.resourceType ?? null,
    resource_id: entry.resourceId ?? null,
    success: entry.success ?? true,
    metadata: sanitizeMetadata(entry.metadata ?? {}) as Record<string, unknown>,
  });
  if (error) throw supabaseErrorToAppError(error);
}

/**
 * Audit helper for admin actions. Never throws: an audit write failure is
 * logged with a fixed, secret-safe message so it cannot take an admin
 * workflow down. Returns whether the row was written.
 */
export async function logAdminAction(
  service: SupabaseClient<Database>,
  entry: AuditLogEntry
): Promise<boolean> {
  try {
    await insertAuditLog(service, entry);
    return true;
  } catch {
    console.error(
      `Admin audit log write failed for action "${entry.action}".`
    );
    return false;
  }
}