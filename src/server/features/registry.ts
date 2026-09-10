import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { supabaseErrorToAppError } from "@/server/data/errors";
import { NotFoundError } from "@/server/errors";

/**
 * Service-role functions for the features registry. The registry is a
 * server-side catalog of app capabilities that admins toggle on/off. Enforcing
 * a feature happens in each feature's own server code path (requireFeature);
 * this module only manages the persisted toggle state.
 */

export interface FeatureSummary {
  id: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  availableToUsers: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const FEATURE_FIELDS =
  "id, key, name, description, enabled, available_to_users, version, created_at, updated_at";

type FeatureRow = Database["public"]["Tables"]["features"]["Row"];

function toSummary(row: FeatureRow): FeatureSummary {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    availableToUsers: row.available_to_users,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Lists every feature in the registry, ordered by name. */
export async function listFeatures(
  service: SupabaseClient<Database>
): Promise<FeatureSummary[]> {
  const { data, error } = await service
    .from("features")
    .select(FEATURE_FIELDS)
    .order("name");
  if (error) throw supabaseErrorToAppError(error);
  return (data ?? []).map(toSummary);
}

/** Lists features currently available to regular users (enabled + visible). */
export async function listAvailableFeatures(
  service: SupabaseClient<Database>
): Promise<FeatureSummary[]> {
  const all = await listFeatures(service);
  return all.filter((f) => f.enabled && f.availableToUsers);
}

export async function getFeatureByKey(
  service: SupabaseClient<Database>,
  key: string
): Promise<FeatureSummary | null> {
  const { data, error } = await service
    .from("features")
    .select(FEATURE_FIELDS)
    .eq("key", key)
    .maybeSingle();
  if (error) throw supabaseErrorToAppError(error);
  return data ? toSummary(data) : null;
}

export interface UpdateFeatureInput {
  name?: string;
  description?: string;
  enabled?: boolean;
  availableToUsers?: boolean;
}

/**
 * Updates registry metadata / toggles. Always bumps `version` so clients can
 * detect a registry change and refetch. Throws NotFoundError for unknown keys.
 */
export async function updateFeature(
  service: SupabaseClient<Database>,
  key: string,
  patch: UpdateFeatureInput
): Promise<FeatureSummary> {
  const existing = await getFeatureByKey(service, key);
  if (!existing) throw new NotFoundError(`Feature "${key}" does not exist.`);

  const update: Database["public"]["Tables"]["features"]["Update"] = {
    version: existing.version + 1,
  };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.enabled !== undefined) update.enabled = patch.enabled;
  if (patch.availableToUsers !== undefined) update.available_to_users = patch.availableToUsers;

  const { data, error } = await service
    .from("features")
    .update(update)
    .eq("key", key)
    .select(FEATURE_FIELDS)
    .maybeSingle();
  if (error) throw supabaseErrorToAppError(error);
  if (!data) throw new NotFoundError(`Feature "${key}" does not exist.`);
  return toSummary(data);
}