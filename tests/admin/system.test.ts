import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getSystemErrors, getSystemHealth } from "@/server/admin/system";

vi.mock("@/server/admin/stats", () => ({
  getAdminStats: vi.fn().mockResolvedValue({
    users: 10,
    usersPending: 1,
    usersApproved: 6,
    usersRejected: 0,
    usersDisabled: 1,
    conversations: 24,
    messages: 120,
    aiRequests: 40,
    aiRequestsToday: 2,
    featuresEnabled: 3,
    featuresTotal: 11,
    proposalsOpen: 1,
    failedActionsRecent: 5,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSystemHealth", () => {
  it("reports ok when the database responds", async () => {
    const service = {} as SupabaseClient<Database>;
    const health = await getSystemHealth(service);
    expect(health.status).toBe("ok");
    expect(health.database).toBe("ok");
    expect(health.stats.users).toBe(10);
    expect(health.stats.conversations).toBe(24);
    expect(health.stats.messages).toBe(120);
  });

  it("reports degraded when stats fail, without throwing", async () => {
    const { getAdminStats } = await import("@/server/admin/stats");
    vi.mocked(getAdminStats).mockRejectedValueOnce(new Error("db down"));
    const health = await getSystemHealth({} as SupabaseClient<Database>);
    expect(health.status).toBe("degraded");
    expect(health.database).toBe("unreachable");
    expect(health.stats.users).toBe(0);
  });
});

describe("getSystemErrors", () => {
  it("maps failed audit rows to a readable list", async () => {
    const rows = [
      {
        id: "1",
        action: "admin.reauth",
        actor_id: "a",
        resource_type: "user",
        metadata: { error: "password mismatch" },
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    const service = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;
    const errors = await getSystemErrors(service);
    expect(errors).toHaveLength(1);
    expect(errors[0].action).toBe("admin.reauth");
    expect(errors[0].message).toBe("password mismatch");
  });
});