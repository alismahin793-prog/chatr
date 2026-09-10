import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { supabaseErrorToAppError } from "@/server/data/errors";
import { NotFoundError } from "@/server/errors";

/**
 * Account directory lookups for the admin "Users" section. Everything runs via
 * the service role so admins can see all accounts, including their lifecycle
 * flags. Email lives in Supabase Auth, so searches query the auth admin API and
 * then enrich with profile data.
 */

export type AccountRole = "user" | "super_admin";
export type AccountStatus = "active" | "approved" | "pending" | "rejected" | "disabled";

export interface AccountSummary {
  id: string;
  email: string;
  displayName: string | null;
  role: AccountRole | null;
  status: AccountStatus;
  isTestUser: boolean;
  expiresAt: string | null;
  createdAt: string;
  permissionIds: string[];
}

export interface AccountDetails extends AccountSummary {
  capabilityIds: string[];
  conversationCount: number;
}

const PROFILE_FIELDS =
  "id, display_name, role, status, is_test_user, expires_at, created_at";

type ProfileData = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "display_name" | "role" | "status" | "is_test_user" | "expires_at" | "created_at"
>;

function toSummary(
  profile: ProfileData,
  email: string,
  permissionIds: string[]
): AccountSummary {
  return {
    id: profile.id,
    email,
    displayName: profile.display_name,
    role:
      profile.role === "super_admin"
        ? "super_admin"
        : profile.role === "user"
          ? "user"
          : null,
    status: profile.status,
    isTestUser: profile.is_test_user,
    expiresAt: profile.expires_at,
    createdAt: profile.created_at,
    permissionIds,
  };
}

async function loadPermissions(
  service: SupabaseClient<Database>,
  userId: string
): Promise<string[]> {
  const { data, error } = await service
    .from("admin_permissions")
    .select("permission")
    .eq("user_id", userId);
  if (error) throw supabaseErrorToAppError(error);
  return data?.map((r) => r.permission) ?? [];
}

async function loadCapabilities(
  service: SupabaseClient<Database>,
  userId: string
): Promise<string[]> {
  const { data, error } = await service
    .from("app_permissions")
    .select("permission")
    .eq("user_id", userId);
  if (error) throw supabaseErrorToAppError(error);
  return data?.map((r) => r.permission) ?? [];
}

/**
 * Searches accounts by email or display name (case-insensitive). Email matches
 * come from the Auth admin list, name matches from profiles. Results are merged
 * de-duplicated and limited.
 */
export async function searchAccounts(
  service: SupabaseClient<Database>,
  query: string,
  limit = 20
): Promise<AccountSummary[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const { data: nameMatches, error: nameError } = await service
    .from("profiles")
    .select(PROFILE_FIELDS)
    .ilike("display_name", `%${q}%`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (nameError) throw supabaseErrorToAppError(nameError);

  const { data: authUsers, error: authError } = await service.auth.admin.listUsers();
  if (authError) throw supabaseErrorToAppError(authError);
  const authList = authUsers?.users ?? [];

  const emailQuery = q.includes("@") ? q : `%${q}%`;
  const emailMatches = authList.filter((u) =>
    (u.email ?? "").toLowerCase().includes(q) || (q.includes("@") && (u.email ?? "").toLowerCase() === emailQuery)
  );

  const profileByUserId = new Map<string, ProfileData>();
  for (const p of nameMatches ?? []) profileByUserId.set(p.id, p);

  const seen = new Set<string>();
  const rows: AccountSummary[] = [];

  for (const profile of nameMatches ?? []) {
    seen.add(profile.id);
    const authUser = authList.find((u) => u.id === profile.id);
    const permissions = await loadPermissions(service, profile.id);
    rows.push(toSummary(profile, authUser?.email ?? "", permissions));
  }

  for (const authUser of emailMatches) {
    if (seen.has(authUser.id) || rows.length >= limit) continue;
    seen.add(authUser.id);
    const permissions = await loadPermissions(service, authUser.id);
    const profile = profileByUserId.get(authUser.id);
    if (profile) {
      rows.push(toSummary(profile, authUser.email ?? "", permissions));
      continue;
    }
    rows.push({
      id: authUser.id,
      email: authUser.email ?? "",
      displayName: null,
      role: null,
      status: "active",
      isTestUser: false,
      expiresAt: null,
      createdAt: authUser.created_at ?? new Date().toISOString(),
      permissionIds: permissions,
    });
  }

  return rows.slice(0, limit);
}

export async function getAccountDetails(
  service: SupabaseClient<Database>,
  userId: string
): Promise<AccountDetails> {
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select(PROFILE_FIELDS)
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw supabaseErrorToAppError(profileError);
  if (!profile) throw new NotFoundError("Account not found.");

  const { data: authUser, error: authError } = await service.auth.admin.getUserById(
    userId
  );
  if (authError) throw supabaseErrorToAppError(authError);

  const [permissionIds, capabilityIds, conversationCount] = await Promise.all([
    loadPermissions(service, userId),
    loadCapabilities(service, userId),
    (async () => {
      const { count, error } = await service
        .from("conversations")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);
      if (error) throw supabaseErrorToAppError(error);
      return count ?? 0;
    })(),
  ]);

  const summary = toSummary(profile, authUser?.user?.email ?? "", permissionIds);
  return { ...summary, capabilityIds, conversationCount };
}

/**
 * Lists the full account directory for the Admin "Users" page (newest first).
 * Batches the auth-user lookup and permission reads so the table does not make
 * one round trip per row.
 */
export async function listAllAccounts(
  service: SupabaseClient<Database>,
  limit = 500
): Promise<AccountSummary[]> {
  const { data: profiles, error: profileError } = await service
    .from("profiles")
    .select(PROFILE_FIELDS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (profileError) throw supabaseErrorToAppError(profileError);

  const { data: authUsers, error: authError } = await service.auth.admin.listUsers();
  if (authError) throw supabaseErrorToAppError(authError);
  const emailById = new Map(authUsers?.users?.map((u) => [u.id, u.email ?? ""]) ?? []);

  const ids = (profiles ?? []).map((profile) => profile.id);
  const permissionByUserId = new Map<string, string[]>();
  if (ids.length > 0) {
    const { data: permissionRows, error: permError } = await service
      .from("admin_permissions")
      .select("user_id, permission")
      .in("user_id", ids);
    if (permError) throw supabaseErrorToAppError(permError);
    for (const row of permissionRows ?? []) {
      const list = permissionByUserId.get(row.user_id) ?? [];
      list.push(row.permission);
      permissionByUserId.set(row.user_id, list);
    }
  }

  return (profiles ?? []).map((profile) =>
    toSummary(
      profile,
      emailById.get(profile.id) ?? "",
      permissionByUserId.get(profile.id) ?? []
    )
  );
}