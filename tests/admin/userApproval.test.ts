import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  listAccountsByStatus,
  setAccountStatus,
} from "@/server/admin/userApproval";
import { ForbiddenError, NotFoundError } from "@/server/errors";

const ALICE_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "99999999-9999-4999-8999-999999999999";

const PROFILE = {
  id: ALICE_ID,
  display_name: "Alice",
  role: "user",
  status: "pending",
  is_test_user: false,
  created_at: "2026-09-01T00:00:00.000Z",
} as {
  id: string;
  display_name: string | null;
  role: string;
  status: "active" | "approved" | "pending" | "rejected" | "disabled";
  is_test_user: boolean;
  created_at: string;
};

function fakeSupabase(profile: typeof PROFILE | null) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: profile ? [profile] : [],
                error: null,
              }),
            }),
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: profile,
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      return { select: vi.fn() };
    }),
    auth: {
      admin: {
        listUsers: vi.fn().mockResolvedValue({
          data: {
            users: [{ id: ALICE_ID, email: "alice@example.com" }],
          },
          error: null,
        }),
        getUserById: vi.fn().mockResolvedValue({
          data: { user: { id: ALICE_ID, email: "alice@example.com" } },
          error: null,
        }),
      },
    },
  } as unknown as SupabaseClient<Database>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listAccountsByStatus", () => {
  it("returns profiles with emails resolved from the Auth admin list", async () => {
    const service = fakeSupabase({ ...PROFILE, status: "pending" });
    const rows = await listAccountsByStatus(service, ["pending"]);
    expect(rows).toEqual([
      expect.objectContaining({
        id: ALICE_ID,
        email: "alice@example.com",
        status: "pending",
      }),
    ]);
    expect(service.from).toHaveBeenCalledWith("profiles");
  });

  it("returns an empty list for an empty status set", async () => {
    const service = fakeSupabase(null);
    expect(await listAccountsByStatus(service, [])).toEqual([]);
  });
});

describe("setAccountStatus", () => {
  it("approves a pending account and returns the updated summary", async () => {
    const service = fakeSupabase({ ...PROFILE, status: "approved" });
    const user = await setAccountStatus(service, ALICE_ID, "approved");
    expect(user.status).toBe("approved");
    expect(service.from).toHaveBeenCalledWith("profiles");
  });

  it("rejects an unknown account with NotFoundError", async () => {
    const service = fakeSupabase(null);
    await expect(setAccountStatus(service, ALICE_ID, "approved")).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  it("refuses to disable the super_admin owner (self-protection)", async () => {
    const service = fakeSupabase({ ...PROFILE, role: "super_admin", status: "approved" });
    await expect(setAccountStatus(service, OWNER_ID, "disabled")).rejects.toBeInstanceOf(
      ForbiddenError
    );
  });

  it("skips a write when the status is already the target", async () => {
    const service = fakeSupabase({ ...PROFILE, status: "approved" });
    const user = await setAccountStatus(service, ALICE_ID, "approved");
    expect(user.status).toBe("approved");
    const from = service.from("profiles");
    expect(from.update).not.toHaveBeenCalled();
  });
});