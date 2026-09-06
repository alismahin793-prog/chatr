import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { supabaseEnv } from "./env";

/**
 * Server-only Supabase client authenticated as the service role.
 *
 * This client bypasses Row Level Security, so it is used ONLY for privileged
 * server-side writes that tenants must never perform themselves (admin
 * elevation timestamps and audit-log entries). It must never be imported
 * from client-side code, and SUPABASE_SERVICE_ROLE_KEY must never be exposed
 * to the browser (it is a server-only env var, not NEXT_PUBLIC_*).
 *
 * Fails closed: if the service role key is not configured, construction throws
 * and admin operations are unavailable.
 */
export function createServiceClient(serviceRoleKey?: string) {
  const { url } = supabaseEnv();
  const key = (serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!key) {
    throw new Error(
      "Supabase service role key is not configured (SUPABASE_SERVICE_ROLE_KEY)."
    );
  }

  return createSupabaseClient<Database>(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}