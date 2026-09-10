import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  getAccountDetails,
  searchAccounts,
} from "@/server/admin/accounts";
import { NotFoundError } from "@/server/errors";

const PROFILE = {
  id: "11111111-1111-4111-8111-111111111111",
  display_name: "Alice",
  role: "user",
  status: "active",
  is_test_user: false,
  expires_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
};

function fakeSupabase(role: string = PROFILE.role) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: vi.fn().mockReturnValue({
            ilike: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [PROFILE], error: null }),
              }),
            }),
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { ...PROFILE, role },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "admin_permissions" || table === "app_permissions") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: table === "admin_permissions" ? [{ permission: "view_users" }] : [{ permission: "chat" }],
              error: null,
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ count: 4, error: null }),
        }),
      };
    }),
    auth: {
      admin: {
        listUsers: vi.fn().mockResolvedValue({
          data: {
            users: [
              { id: PROFILE.id, email: "alice@example.com", created_at: PROFILE.created_at },
            ],
          },
          error: null,
        }),
        getUserById: vi.fn().mockResolvedValue({
          data: { user: { id: PROFILE.id, email: "alice@example.com" } },
          error: null,
        }),
      },
    },
  } as unknown as SupabaseClient<Database>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchAccounts", () => {
  it("searches by display name with email enrichment from Auth", async () => {
    const service = fakeSupabase();
    const accounts = await searchAccounts(service, "ali");
    expect(accounts).toHaveLength(1);
    expect(accounts[0].email).toBe("alice@example.com");
    expect(accounts[0].role).toBe("user");
    expect(accounts[0].isTestUser).toBe(false);
    expect(accounts[0].permissionIds).toEqual(["view_users"]);
  });

  it("returns an empty list for an empty query", async () => {
    const service = fakeSupabase();
    expect(await searchAccounts(service, "   ")).toEqual([]);
  });
});

describe("getAccountDetails", () => {
  it("combines profile, auth email, permissions, capabilities, and usage", async () => {
    const service = fakeSupabase();
    const details = await getAccountDetails(service, PROFILE.id);
    expect(details.email).toBe("alice@example.com");
    expect(details.permissionIds).toEqual(["view_users"]);
    expect(details.capabilityIds).toEqual(["chat"]);
    expect(details.conversationCount).toBe(4);
  });

  it("maps a super_admin role through the directory", async () => {
    const service = fakeSupabase("super_admin");
    const details = await getAccountDetails(service, PROFILE.id);
    expect(details.role).toBe("super_admin");
  });

  it("throws NotFoundError for an unknown account", async () => {
    const service = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
      auth: { admin: { getUserById: vi.fn() } },
    } as unknown as SupabaseClient<Database>;
    await expect(getAccountDetails(service, PROFILE.id)).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});