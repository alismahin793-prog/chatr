import { describe, expect, it, beforeEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  assertAccountAccess,
  EXPIRED_ACCOUNT_MESSAGE,
  DISABLED_ACCOUNT_MESSAGE,
  PENDING_ACCOUNT_MESSAGE,
  REJECTED_ACCOUNT_MESSAGE,
  loadAccountState,
  requireCapability,
} from "@/server/auth/capabilities";
import { ForbiddenError } from "@/server/errors";

type ProfileState = {
  role: string | null;
  status: "active" | "approved" | "pending" | "rejected" | "disabled";
  is_test_user: boolean;
  expires_at: string | null;
} | null;

let profileState: ProfileState = null;
let appCapability: string | null = null;

/**
 * Minimal Supabase client whose .from(table) returns a suitable query chain:
 * profiles -> select().eq().maybeSingle()
 * app_permissions -> select().eq().eq().maybeSingle()
 */
function buildClient(): SupabaseClient<Database> {
  const chain = {
    profiles: () => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: profileState,
            error: null,
          }),
        }),
      }),
    }),
    app_permissions: () => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: appCapability === null ? null : { permission: appCapability },
              error: null,
            }),
          }),
        }),
      }),
    }),
  };
  return {
    from: vi.fn((table: string) =>
      (chain as Record<string, () => unknown>)[table]?.()
    ),
  } as unknown as SupabaseClient<Database>;
}

function mockState(state: ProfileState, capability: string | null = null) {
  profileState = state;
  appCapability = capability;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState(null, null);
});

describe("assertAccountAccess (pure account-lifecycle check)", () => {
  it("allows an active account", () => {
    expect(() =>
      assertAccountAccess({ isTestUser: true, role: "user", status: "active", expiresAt: null })
    ).not.toThrow();
  });

  it("allows an approved account (migration 6)", () => {
    expect(() =>
      assertAccountAccess({ isTestUser: false, role: "user", status: "approved", expiresAt: null })
    ).not.toThrow();
  });

  it("allows an active account whose expiration is still in the future", () => {
    const future = new Date(Date.now() + 100_000).toISOString();
    expect(() =>
      assertAccountAccess({ isTestUser: true, role: "user", status: "active", expiresAt: future })
    ).not.toThrow();
  });

  it("rejects a disabled account with the safe user message", () => {
    try {
      assertAccountAccess({ isTestUser: true, role: "user", status: "disabled", expiresAt: null });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as ForbiddenError).message).toBe(DISABLED_ACCOUNT_MESSAGE);
    }
  });

  it("rejects a pending account until an admin approves it", () => {
    try {
      assertAccountAccess({ isTestUser: false, role: "user", status: "pending", expiresAt: null });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as ForbiddenError).message).toBe(PENDING_ACCOUNT_MESSAGE);
    }
  });

  it("rejects a rejected account with the safe user message", () => {
    try {
      assertAccountAccess({ isTestUser: false, role: "user", status: "rejected", expiresAt: null });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as ForbiddenError).message).toBe(REJECTED_ACCOUNT_MESSAGE);
    }
  });

  it("never blocks the super_admin owner, even when its status is odd", () => {
    expect(() =>
      assertAccountAccess({ isTestUser: false, role: "super_admin", status: "pending", expiresAt: null })
    ).not.toThrow();
  });

  it("rejects an expired account with the safe user message", () => {
    const past = new Date(Date.now() - 100_000).toISOString();
    try {
      assertAccountAccess({ isTestUser: true, role: "user", status: "active", expiresAt: past });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as ForbiddenError).message).toBe(EXPIRED_ACCOUNT_MESSAGE);
    }
  });
});

describe("loadAccountState", () => {
  it("treats a missing profile row as an active, unrestricted account", async () => {
    const state = await loadAccountState(buildClient(), "user-1");
    expect(state).toEqual({ isTestUser: false, role: null, status: "active", expiresAt: null });
  });

  it("returns the stored profile lifecycle state (including role)", async () => {
    mockState(
      {
        role: "user",
        status: "pending",
        is_test_user: false,
        expires_at: "2026-01-01T00:00:00.000Z",
      },
      "chat"
    );
    const state = await loadAccountState(buildClient(), "user-1");
    expect(state.isTestUser).toBe(false);
    expect(state.role).toBe("user");
    expect(state.status).toBe("pending");
    expect(state.expiresAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("requireCapability (server-side capability + lifecycle gate)", () => {
  it("allows an active normal user without capability rows (backward compatible)", async () => {
    mockState({ role: "user", status: "active", is_test_user: false, expires_at: null });
    await expect(
      requireCapability(buildClient(), "user-1", "chat")
    ).resolves.toBeUndefined();
  });

  it("allows an approved normal user (registration approved)", async () => {
    mockState({ role: "user", status: "approved", is_test_user: false, expires_at: null });
    await expect(
      requireCapability(buildClient(), "user-1", "chat")
    ).resolves.toBeUndefined();
  });

  it("rejects a pending account before it is approved", async () => {
    mockState({ role: "user", status: "pending", is_test_user: false, expires_at: null });
    await expect(requireCapability(buildClient(), "user-1", "chat")).rejects.toThrow(
      PENDING_ACCOUNT_MESSAGE
    );
  });

  it("rejects a disabled account even if it holds the capability", async () => {
    mockState({ role: "user", status: "disabled", is_test_user: true, expires_at: null }, "chat");
    await expect(requireCapability(buildClient(), "user-1", "chat")).rejects.toThrow(
      DISABLED_ACCOUNT_MESSAGE
    );
  });

  it("rejects an expired account", async () => {
    mockState(
      {
        role: "user",
        status: "active",
        is_test_user: true,
        expires_at: new Date(Date.now() - 1_000).toISOString(),
      },
      "chat"
    );
    await expect(requireCapability(buildClient(), "user-1", "chat")).rejects.toThrow(
      EXPIRED_ACCOUNT_MESSAGE
    );
  });

  it("allows a test user holding the granted capability", async () => {
    mockState({ role: "user", status: "active", is_test_user: true, expires_at: null }, "chat");
    await expect(
      requireCapability(buildClient(), "user-1", "chat")
    ).resolves.toBeUndefined();
  });

  it("rejects a test user missing the capability even though signed in", async () => {
    mockState({ role: "user", status: "active", is_test_user: true, expires_at: null }, null);
    await expect(requireCapability(buildClient(), "user-1", "chat")).rejects.toThrow(
      "not enabled for your account"
    );
  });
});