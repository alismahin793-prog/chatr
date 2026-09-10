import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getFeatureByKey } from "@/server/features/registry";
import { ForbiddenError } from "@/server/errors";

/**
 * Server-side feature gate. Every feature that exists in the registry must be
 * enforced with this helper in its own server path — toggling a feature off
 * makes the API refuse the request BEFORE any expensive work starts.
 *
 * The caller supplies the feature key that the current operation depends on.
 * Normal chat is deliberately NOT gated here: chat remains available regardless
 * of registry toggles, so `/api/chat` can never be broken by a registry row.
 */
export async function requireFeature(
  service: SupabaseClient<Database>,
  key: string
): Promise<void> {
  const feature = await getFeatureByKey(service, key);
  if (!feature) {
    throw new ForbiddenError(`Feature "${key}" is unknown and therefore disabled.`);
  }
  if (!feature.enabled) {
    throw new ForbiddenError(`Feature "${key}" is currently disabled.`);
  }
  if (!feature.availableToUsers) {
    throw new ForbiddenError(`Feature "${key}" is not available to your account.`);
  }
}

/** Non-throwing variant used when a route wants to soft-skip a feature. */
export async function isFeatureEnabled(
  service: SupabaseClient<Database>,
  key: string
): Promise<boolean> {
  const feature = await getFeatureByKey(service, key);
  return feature?.enabled === true && feature.availableToUsers === true;
}