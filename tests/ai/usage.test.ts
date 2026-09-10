import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getAiUsageStats, listAiRequestLogs, recordAiRequest } from "@/server/ai/usage";

function fakeSupabase() {
  const rows = [
    { provider: "openai", model: "gpt-4o-mini", created_at: "2026-01-05T10:00:00.000Z" },
    { provider: "openai", model: "gpt-4o-mini", created_at: "2026-01-05T11:00:00.000Z" },
    { provider: "gemini", model: "gemini-3.6-flash", created_at: "2026-01-06T09:00:00.000Z" },
  ];
  return {
    from: vi.fn().mockImplementation(() => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayPrefix = todayStart.toISOString().slice(0, 10);
      const base = {
        insert: vi.fn().mockResolvedValue({ error: null }),
        select: vi.fn((_c: string, opts?: { count?: "exact" }) => {
          const head = opts?.count === "exact";
          const countResp = { count: rows.length, error: null, data: null };
          const todayCountResp = { count: 1, error: null, data: null };
          const listResp = { data: rows, error: null, count: rows.length };
          return {
            ...(head ? countResp : listResp),
            gte: vi.fn((col: string, value: string) => {
              const todayOnly =
                col === "created_at" && value.startsWith(todayPrefix);
              return {
                ...(head
                  ? todayOnly
                    ? todayCountResp
                    : countResp
                  : { data: rows, error: null }),
                order: vi.fn().mockReturnValue({ data: rows, error: null }),
              };
            }),
            order: vi.fn().mockReturnValue({ data: rows, error: null }),
          };
        }),
      };
      return base;
    }),
  } as unknown as SupabaseClient<Database>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordAiRequest", () => {
  it("inserts a row for a completed request", async () => {
    const service = fakeSupabase();
    await recordAiRequest(service, {
      userId: "11111111-1111-4111-8111-111111111111",
      conversationId: "22222222-2222-4222-8222-222222222222",
      provider: "openai",
      model: "gpt-4o-mini",
    });
    expect(service.from).toHaveBeenCalledWith("ai_request_log");
  });

  it("never throws when the insert fails", async () => {
    const service = {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockRejectedValue(new Error("db down")),
      }),
    } as unknown as SupabaseClient<Database>;
    await expect(
      recordAiRequest(service, {
        userId: "11111111-1111-4111-8111-111111111111",
        provider: "openai",
        model: "gpt-4o-mini",
      })
    ).resolves.toBeUndefined();
  });
});

describe("getAiUsageStats", () => {
  it("aggregates totals, per-provider, per-model, and a 7-day series", async () => {
    const usage = await getAiUsageStats(fakeSupabase());
    expect(usage.total).toBe(3);
    expect(usage.today).toBe(1);
    expect(usage.byProvider).toMatchObject({ openai: 2, gemini: 1 });
    expect(usage.byModel).toMatchObject({ "gpt-4o-mini": 2, "gemini-3.6-flash": 1 });
    expect(usage.last7Days).toHaveLength(7);
  });
});

describe("listAiRequestLogs", () => {
  const ROWS = [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      user_id: "11111111-1111-4111-8111-111111111111",
      conversation_id: "22222222-2222-4222-8222-222222222222",
      provider: "gemini",
      model: "gemini-3.6-flash",
      created_at: "2026-01-06T09:00:00.000Z",
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      user_id: "33333333-3333-4333-8333-333333333333",
      conversation_id: null,
      provider: "openai",
      model: "gpt-4o-mini",
      created_at: "2026-01-05T10:00:00.000Z",
    },
  ];

  function fakeLogService() {
    return {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: ROWS, error: null }),
          }),
        }),
      }),
      auth: {
        admin: {
          listUsers: vi.fn().mockResolvedValue({
            error: null,
            data: {
              users: [
                { id: "11111111-1111-4111-8111-111111111111", email: "a@example.com" },
                { id: "33333333-3333-4333-8333-333333333333", email: "b@example.com" },
              ],
            },
          }),
        },
      },
    } as unknown as SupabaseClient<Database>;
  }

  it("returns metadata rows with emails resolved from the auth directory", async () => {
    const logs = await listAiRequestLogs(fakeLogService());
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({
      userEmail: "a@example.com",
      provider: "gemini",
      model: "gemini-3.6-flash",
      conversationId: "22222222-2222-4222-8222-222222222222",
    });
    expect(logs[1].userEmail).toBe("b@example.com");
  });

  it("falls back to a null email when the auth user is missing", async () => {
    const service = fakeLogService();
    (service.auth.admin.listUsers as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: null,
      data: { users: [] },
    });
    const logs = await listAiRequestLogs(service);
    expect(logs[0].userEmail).toBeNull();
  });

  it("orders newest first and limits the result", async () => {
    const service = fakeLogService();
    await listAiRequestLogs(service, 50);
    const select = (service.from as unknown as ReturnType<typeof vi.fn>)
      .mock.results[0].value.select;
    const order = select.mock.results[0].value.order;
    expect(select).toHaveBeenCalledWith(
      "id, user_id, conversation_id, provider, model, created_at"
    );
    expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(order.mock.results[0].value.limit).toHaveBeenCalledWith(50);
  });
});