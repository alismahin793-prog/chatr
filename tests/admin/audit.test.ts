import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { insertAuditLog, logAdminAction, sanitizeMetadata } from "@/server/admin/audit";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function fakeService(insertResult: { error: unknown } | { error: null }) {
  return {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockResolvedValue(insertResult),
    }),
  } as unknown as SupabaseClient<Database>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sanitizeMetadata", () => {
  it("redacts secret-looking keys at any depth and in arrays", () => {
    const input = {
      password: "zxc",
      apiKey: "sk-abc",
      Authorization: "Bearer x",
      access_token: "tok",
      good: "kept",
      nested: { secret: "deep", token: "t", label: "fine" },
      list: [{ password: "a", name: "b" }],
    };
    expect(sanitizeMetadata(input)).toEqual({
      password: "[REDACTED]",
      apiKey: "[REDACTED]",
      Authorization: "[REDACTED]",
      access_token: "[REDACTED]",
      good: "kept",
      nested: { secret: "[REDACTED]", token: "[REDACTED]", label: "fine" },
      list: [{ password: "[REDACTED]", name: "b" }],
    });
  });

  it("passes through primitives and arrays untouched", () => {
    expect(sanitizeMetadata([1, "two", null])).toEqual([1, "two", null]);
  });

  it("never leaks the credential value (case-insensitive key match)", () => {
    const cleaned = JSON.stringify(sanitizeMetadata({ PassWord: "hunter2", oauth_token: "x" }));
    expect(cleaned).not.toContain("hunter2");
  });
});

describe("insertAuditLog", () => {
  it("inserts a fully-qualified, sanitized row", async () => {
    const service = fakeService({ error: null });
    await insertAuditLog(service, {
      actorId: USER_ID,
      action: "admin.reauth",
      resourceType: "user",
      resourceId: USER_ID,
      success: true,
      metadata: { expiresInSeconds: 30, password: "never-here" },
    });
    expect(service.from).toHaveBeenCalledWith("audit_log");
    const insert = vi.mocked(service.from("").insert);
    expect(insert).toHaveBeenCalledWith({
      actor_id: USER_ID,
      action: "admin.reauth",
      resource_type: "user",
      resource_id: USER_ID,
      success: true,
      metadata: { expiresInSeconds: 30, password: "[REDACTED]" },
    });
  });

  it("throws on a database error so callers can fail closed", async () => {
    const service = fakeService({ error: { message: "db down", code: "57014" } });
    await expect(
      insertAuditLog(service, { actorId: USER_ID, action: "admin.status" })
    ).rejects.toThrow();
  });
});

describe("logAdminAction", () => {
  it("logs a successful action and returns true", async () => {
    const service = fakeService({ error: null });
    const ok = await logAdminAction(service, {
      actorId: USER_ID,
      action: "admin.status",
      success: true,
    });
    expect(ok).toBe(true);
  });

  it("swallows failures, logs a fixed safe message, and the secret never reaches the log", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const service = fakeService({ error: { message: "boom" } });

    const SECRET = "super-secret-value";
    const ok = await logAdminAction(service, {
      actorId: USER_ID,
      action: "admin.status",
      metadata: { password: SECRET },
    });

    expect(ok).toBe(false);
    const logged = String(vi.mocked(console.error).mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("Admin audit log write failed");
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain("boom");
  });
});