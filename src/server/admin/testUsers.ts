import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { supabaseErrorToAppError } from "@/server/data/errors";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import {
  type AccountStatus,
  type Capability,
  isValidCapability,
} from "@/server/auth/capabilities";

/**
 * Service-role functions for managing test users. Everything here runs with
 * the service role ONLY (created via createServiceClient) — never with a
 * tenant client, so tenants cannot list, create, disable, or otherwise reach
 * each other's accounts or capabilities.
 *
 * Sensitive flows (password handling) go through the Supabase Auth admin API;
 * passwords are never stored, returned, or logged by this code.
 */

export interface TestUserSummary {
  id: string;
  email: string;
  displayName: string | null;
  status: AccountStatus;
  isTestUser: boolean;
  expiresAt: string | null;
  createdAt: string;
  capabilities: Capability[];
}

export type CreateTestUserInput = {
  email: string;
  displayName: string;
  password: string;
  status: AccountStatus;
  permissions: Capability[];
  expiresAt?: string | null;
};

export type UpdateTestUserInput = {
  displayName?: string;
  status?: AccountStatus;
  expiresAt?: string | null;
};

const PROFILE_FIELDS =
  "id, display_name, role, status, is_test_user, expires_at, created_at";

/** Shape returned by the curated PROFILE_FIELDS select (no admin_verified_at). */
type ProfileData = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "display_name" | "role" | "status" | "is_test_user" | "expires_at" | "created_at"
>;

function assertValidCapabilities(capabilities: string[]): Capability[] {
  const unique = Array.from(new Set(capabilities));
  for (const c of unique) {
    if (!isValidCapability(c)) {
      throw new ValidationError(`Unknown capability: ${c}`);
    }
  }
  return unique as Capability[];
}

async function loadProfileOrThrow(
  service: SupabaseClient<Database>,
  userId: string
): Promise<ProfileData | null> {
  const { data, error } = await service
    .from("profiles")
    .select(PROFILE_FIELDS)
    .eq("id", userId)
    .maybeSingle();
  if (error) throw supabaseErrorToAppError(error);
  return data ?? null;
}

async function loadCapabilities(
  service: SupabaseClient<Database>,
  userId: string
): Promise<Capability[]> {
  const { data, error } = await service
    .from("app_permissions")
    .select("permission")
    .eq("user_id", userId);
  if (error) throw supabaseErrorToAppError(error);
  return (data?.map((r) => r.permission).filter(isValidCapability) ?? []).sort();
}

async function toSummary(
  service: SupabaseClient<Database>,
  profile: ProfileData,
  email: string
): Promise<TestUserSummary> {
  const capabilities = await loadCapabilities(service, profile.id);
  return {
    id: profile.id,
    email,
    displayName: profile.display_name,
    status: profile.status,
    isTestUser: profile.is_test_user,
    expiresAt: profile.expires_at,
    createdAt: profile.created_at,
    capabilities,
  };
}

async function emailForUser(
  service: SupabaseClient<Database>,
  userId: string
): Promise<string> {
  const { data, error } = await service.auth.admin.getUserById(userId);
  if (error) throw supabaseErrorToAppError(error);
  return data.user?.email ?? "";
}

async function requireTestUser(
  service: SupabaseClient<Database>,
  userId: string
): Promise<ProfileData> {
  const profile = await loadProfileOrThrow(service, userId);
  if (!profile) throw new NotFoundError("Test user not found.");
  if (!profile.is_test_user || profile.role !== "user") {
    throw new ForbiddenError("This account is not a test user.");
  }
  return profile;
}

/** Lists every test user with their capabilities. Admin read path. */
export async function listTestUsers(
  service: SupabaseClient<Database>
): Promise<TestUserSummary[]> {
  const { data: profiles, error: profileError } = await service
    .from("profiles")
    .select(PROFILE_FIELDS)
    .eq("is_test_user", true)
    .order("created_at");
  if (profileError) throw supabaseErrorToAppError(profileError);

  const { data: authUsers, error: authError } = await service.auth.admin.listUsers();
  if (authError) throw supabaseErrorToAppError(authError);
  const emailById = new Map(
    authUsers?.users?.map((u) => [u.id, u.email ?? ""]) ?? []
  );

  const rows: TestUserSummary[] = [];
  for (const profile of profiles ?? []) {
    rows.push(
      await toSummary(service, profile, emailById.get(profile.id) ?? "")
    );
  }
  return rows;
}

/**
 * Creates a test user. The account is created through Supabase Auth (the
 * signup trigger auto-creates a profile row), then the profile is flagged as
 * a test user with the requested status/expiry and the granted capabilities
 * are inserted. Uses the service role throughout. Returns a summary containing
 * NO password information.
 */
export async function createTestUser(
  service: SupabaseClient<Database>,
  input: CreateTestUserInput,
  actorId: string
): Promise<TestUserSummary> {
  const capabilities = assertValidCapabilities(input.permissions);
  const { data, error } = await service.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { display_name: input.displayName },
  });
  if (error) {
    throw new ValidationError(`Could not create test user: ${error.message}`);
  }
  const userId = data.user?.id;
  if (!userId) {
    throw new ValidationError("Could not create test user: no user returned.");
  }

  const profileUpdate: Database["public"]["Tables"]["profiles"]["Update"] = {
    display_name: input.displayName,
    is_test_user: true,
    status: input.status,
    expires_at: input.expiresAt ?? null,
  };

  const { data: updated, error: updateError } = await service
    .from("profiles")
    .update(profileUpdate)
    .eq("id", userId)
    .select()
    .maybeSingle();
  if ((updateError || !updated) && updateError?.code !== "PGRST116") {
    // The signup trigger normally creates the row; if it did not, create it
    // through the service role so the newly provisioned account is always
    // fully managed.
    const insertProfile: Database["public"]["Tables"]["profiles"]["Insert"] = {
      id: userId,
      display_name: input.displayName,
      is_test_user: true,
      status: input.status,
      expires_at: input.expiresAt ?? null,
    };
    const { error: insertError } = await service
      .from("profiles")
      .insert(insertProfile);
    if (insertError) throw supabaseErrorToAppError(insertError);
  }

  if (capabilities.length > 0) {
    const { error: capError } = await service.from("app_permissions").insert(
      capabilities.map((permission) => ({
        user_id: userId,
        permission,
        granted_by: actorId,
      }))
    );
    if (capError) throw supabaseErrorToAppError(capError);
  }

  const profile = await requireTestUser(service, userId);
  return toSummary(service, profile, input.email);
}

/** Updates lifecycle/identity fields of a test user. */
export async function updateTestUser(
  service: SupabaseClient<Database>,
  userId: string,
  patch: UpdateTestUserInput
): Promise<TestUserSummary> {
  const profile = await requireTestUser(service, userId);

  const update: Database["public"]["Tables"]["profiles"]["Update"] = {};
  if (patch.displayName !== undefined) update.display_name = patch.displayName;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.expiresAt !== undefined) update.expires_at = patch.expiresAt;

  const { error } = await service.from("profiles").update(update).eq("id", userId);
  if (error) throw supabaseErrorToAppError(error);

  const refreshed = await loadProfileOrThrow(service, userId);
  const email = await emailForUser(service, userId);
  return toSummary(service, refreshed ?? profile, email);
}

/**
 * Replaces the capability set of a test user. Removes anything not in the new
 * list, so a revoked capability stops working on the next server check.
 */
export async function replaceTestUserCapabilities(
  service: SupabaseClient<Database>,
  userId: string,
  capabilities: string[],
  actorId: string
): Promise<TestUserSummary> {
  const profile = await requireTestUser(service, userId);
  const next = assertValidCapabilities(capabilities);

  const { error: deleteError } = await service
    .from("app_permissions")
    .delete()
    .eq("user_id", userId);
  if (deleteError) throw supabaseErrorToAppError(deleteError);

  if (next.length > 0) {
    const { error: insertError } = await service.from("app_permissions").insert(
      next.map((permission) => ({
        user_id: userId,
        permission,
        granted_by: actorId,
      }))
    );
    if (insertError) throw supabaseErrorToAppError(insertError);
  }

  const email = await emailForUser(service, userId);
  return toSummary(service, profile, email);
}

/**
 * Resets a test user's password through the Supabase Auth admin API. The new
 * password is only ever passed to Supabase Auth; it is not returned, stored,
 * or logged here.
 */
export async function resetTestUserPassword(
  service: SupabaseClient<Database>,
  userId: string,
  password: string
): Promise<void> {
  await requireTestUser(service, userId);
  const { error } = await service.auth.admin.updateUserById(userId, { password });
  if (error) {
    throw new ValidationError(`Could not reset password: ${error.message}`);
  }
}

/**
 * Revokes a test user: soft-deletes the Supabase Auth account (so the user
 * can no longer sign in) and marks the profile disabled. Their existing
 * conversations/messages are deliberately preserved — only access is taken
 * away. Normal and admin accounts are rejected.
 */
export async function deleteTestUser(
  service: SupabaseClient<Database>,
  userId: string
): Promise<void> {
  const profile = await requireTestUser(service, userId);
  const { error: authError } = await service.auth.admin.deleteUser(userId, true);
  if (authError) throw supabaseErrorToAppError(authError);

  void profile;
  const { error } = await service
    .from("profiles")
    .update({ status: "disabled" })
    .eq("id", userId);
  if (error) throw supabaseErrorToAppError(error);
}