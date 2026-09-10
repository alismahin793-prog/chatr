import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getAdminStats, getRecentActivity } from "@/server/admin/stats";

/**
 * Statistical dashboard queries. All use head-only exact counts; the fake
 * supabase below responds with per-table counts so we can assert aggregation.
 */
function fakeSupabase() {
  const total: Record<string, number> = {
    profiles: 10,
    conversations: 24,
    messages: 120,
    features: 11,
    improvement_proposals: 3,
    ai_request_log: 40,
    audit_log: 5,
  };

  const from = vi.fn().mockImplementation((table: string) => {
    const baseCount = total[table] ?? 0;
    const result = (count: number) => ({ count, error: null, data: null });
    return {
      select: vi.fn(() => ({
        ...result(baseCount),
        gte: (col: string) =>
          result(col === "created_at" ? 20 : baseCount),
        eq: (col: string, value?: string) =>
          result(
            col === "enabled" ? 3 :
            col === "success" ? 1 :
            col === "status" && value === "pending" ? 4 :
            col === "status" && value === "approved" ? 5 :
            col === "status" && value === "rejected" ? 2 :
            col === "status" && value === "disabled" ? 1 :
            baseCount
          ),
        order: () => ({ limit: () => ({ data: [], error: null }) }),
        limit: () => result(baseCount),
      })),
    };
  });

  return { from } as unknown as SupabaseClient<Database>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAdminStats", () => {
  it("aggregates platform totals across all tables", async () => {
    const service = fakeSupabase();
    const stats = await getAdminStats(service);
    expect(stats.users).toBe(10);
    expect(stats.usersPending).toBe(4);
    expect(stats.usersApproved).toBe(5);
    expect(stats.usersRejected).toBe(2);
    expect(stats.usersDisabled).toBe(1);
    expect(stats.conversations).toBe(24);
    expect(stats.messages).toBe(120);
    expect(stats.featuresTotal).toBe(11);
    expect(stats.proposalsOpen).toBe(3);
    expect(stats.aiRequests).toBe(40);
    expect(stats.aiRequestsToday).toBe(20);
    expect(stats.featuresEnabled).toBe(3);
    expect(stats.failedActionsRecent).toBe(1);
  });
});

describe("getRecentActivity", () => {
  it("returns the newest audit actions first", async () => {
    const activity = [
      { id: "1", action: "admin.reauth", actor_id: "a", resource_type: null, success: true, created_at: "2026-01-02T00:00:00.000Z" },
      { id: "2", action: "admin.feature.update", actor_id: "a", resource_type: "feature", success: true, created_at: "2026-01-01T00:00:00.000Z" },
    ];
    const service = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: activity, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;
    const entries = await getRecentActivity(service);
    expect(entries.map((e) => e.action)).toEqual(["admin.reauth", "admin.feature.update"]);
    expect(entries[0].success).toBe(true);
  });
});