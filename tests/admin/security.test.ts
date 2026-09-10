import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  ADMIN_SESSION_TTL_MS,
  adminGuardRedirectPath,
  adminWindowStatus,
  clearAdminVerified,
  markAdminVerified,
  requireAdmin,
  requireAdminIdentity,
  verifyPassword,
  type AdminGuardRedirect,
  type AdminWindowStatus,
} from "@/server/admin/security";
import { requireUser } from "@/server/api/helpers";
import { createServiceClient } from "@/lib/supabase/service";
import {
  AdminReauthRequiredError,
  ForbiddenError,
  UnauthorizedError,
} from "@/server/errors";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/server/api/helpers", () => ({ requireUser: vi.fn() }));

const USER: User = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "admin@example.com",
} as User;

function fakeSupabase(profile: {
  role: string | null;
  status: string | null;
  admin_verified_at: string | null;
}) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: profile, error: null }),
        }),
      }),
    }),
    auth: {
      signInWithPassword: vi.fn(),
    },
  } as unknown as SupabaseClient<Database>;
}

function mockIdentity(profile: {
  role: string;
  status: string;
  admin_verified_at: string | null;
}) {
  const supabase = fakeSupabase(profile);
  vi.mocked(requireUser).mockResolvedValue({ supabase, user: USER } as never);
  vi.mocked(createServiceClient).mockReturnValue({} as never);
  return supabase;
}

function profile(role: string, status: string, admin_verified_at: string | null) {
  return { role, status, admin_verified_at };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("adminWindowStatus (30-second security window)", () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z");

  it("returns 'never' when the admin has not verified", () => {
    expect(adminWindowStatus(null, now)).toBe<AdminWindowStatus>("never");
  });

  it("returns 'never' for a malformed timestamp", () => {
    expect(adminWindowStatus("not-a-timestamp", now)).toBe<AdminWindowStatus>("never");
  });

  it("is active up to and including the 30-second boundary", () => {
    expect(adminWindowStatus(new Date(now - 29_999).toISOString(), now)).toBe("active");
    expect(adminWindowStatus(new Date(now - ADMIN_SESSION_TTL_MS).toISOString(), now)).toBe(
      "active"
    );
  });

  it("expires once the window is exceeded", () => {
    expect(adminWindowStatus(new Date(now - 30_001).toISOString(), now)).toBe("expired");
  });
});

describe("adminGuardRedirectPath (distinguish unauthenticated from unauthorized)", () => {
  it("sends an unauthenticated caller to /login", () => {
    expect(adminGuardRedirectPath(new UnauthorizedError())).toBe<AdminGuardRedirect>(
      "/login"
    );
  });

  it("sends a signed-in non-admin to the access-denied page", () => {
    expect(adminGuardRedirectPath(new ForbiddenError())).toBe<AdminGuardRedirect>(
      "/admin/denied"
    );
  });

  it("fails closed to /login for unexpected errors", () => {
    expect(adminGuardRedirectPath(new Error("boom"))).toBe<AdminGuardRedirect>("/login");
  });
});

describe("requireAdminIdentity (super_admin role + approved status)", () => {
  it("rejects a signed-in normal user (deny by default)", async () => {
    mockIdentity(profile("user", "approved", null));
    await expect(requireAdminIdentity()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects a legacy 'admin' role even when approved", async () => {
    mockIdentity(profile("admin", "approved", null));
    await expect(requireAdminIdentity()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects a user with no profile row at all", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      supabase: fakeSupabase({ role: null, status: null, admin_verified_at: null }),
      user: USER,
    } as never);
    await expect(requireAdminIdentity()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects a super_admin whose account is pending (not yet approved)", async () => {
    mockIdentity(profile("super_admin", "pending", null));
    await expect(requireAdminIdentity()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects a super_admin whose account is rejected or disabled", async () => {
    mockIdentity(profile("super_admin", "rejected", null));
    await expect(requireAdminIdentity()).rejects.toBeInstanceOf(ForbiddenError);
    mockIdentity(profile("super_admin", "disabled", null));
    await expect(requireAdminIdentity()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("accepts an approved super_admin regardless of the security window", async () => {
    mockIdentity(profile("super_admin", "approved", null));
    const ctx = await requireAdminIdentity();
    expect(ctx.user.id).toBe(USER.id);
    expect(createServiceClient).toHaveBeenCalled();
  });

  it("accepts a super_admin with a legacy 'active' status", async () => {
    mockIdentity(profile("super_admin", "active", null));
    const ctx = await requireAdminIdentity();
    expect(ctx.user.id).toBe(USER.id);
  });

  it("propagates an unauthenticated caller", async () => {
    vi.mocked(requireUser).mockRejectedValue(new UnauthorizedError());
    await expect(requireAdminIdentity()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("requireAdmin", () => {
  it("allows an approved super_admin whose password was verified within the window", async () => {
    const verifiedAt = new Date().toISOString();
    mockIdentity(profile("super_admin", "approved", verifiedAt));
    const ctx = await requireAdmin();
    expect(ctx.verifiedAt).toBe(verifiedAt);
    expect(Date.parse(ctx.expiresAt)).toBe(Date.parse(verifiedAt) + ADMIN_SESSION_TTL_MS);
  });

  it("requires re-authentication after the 30-second window expires", async () => {
    const stale = new Date(Date.now() - ADMIN_SESSION_TTL_MS - 1).toISOString();
    mockIdentity(profile("super_admin", "approved", stale));
    await expect(requireAdmin()).rejects.toBeInstanceOf(AdminReauthRequiredError);
  });

  it("requires re-authentication when the admin never verified", async () => {
    mockIdentity(profile("super_admin", "approved", null));
    await expect(requireAdmin()).rejects.toBeInstanceOf(AdminReauthRequiredError);
  });

  it("still requires the 30-second window even for a super_admin", async () => {
    const stale = new Date(Date.now() - ADMIN_SESSION_TTL_MS - 1).toISOString();
    mockIdentity(profile("super_admin", "approved", stale));
    await expect(requireAdmin()).rejects.toBeInstanceOf(AdminReauthRequiredError);
  });

  it("rejects a normal user (deny by default, even with an active window)", async () => {
    mockIdentity(profile("user", "approved", new Date().toISOString()));
    await expect(requireAdmin()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects a pending super_admin even with an active window", async () => {
    mockIdentity(profile("super_admin", "pending", new Date().toISOString()));
    await expect(requireAdmin()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("markAdminVerified / clearAdminVerified", () => {
  function fakeService() {
    return {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;
  }

  it("writes the elevation timestamp through the service role", async () => {
    const service = fakeService();
    const when = "2026-01-01T00:00:00.000Z";
    await markAdminVerified(service, USER.id, when);
    expect(service.from).toHaveBeenCalledWith("profiles");
    const { update } = service.from("");
    expect(update).toHaveBeenCalledWith({ admin_verified_at: when } as never);
  });

  it("clears elevation for the user", async () => {
    const service = fakeService();
    await clearAdminVerified(service, USER.id);
    const { update } = service.from("");
    expect(update).toHaveBeenCalledWith({ admin_verified_at: null } as never);
  });
});

describe("verifyPassword", () => {
  it("verifies a correct password via GoTrue without storing it", async () => {
    const supabase = fakeSupabase(profile("super_admin", "approved", null));
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: { user: USER, session: { access_token: "token" } },
      error: null,
    } as never);
    const result = await verifyPassword(supabase, "admin@example.com", "s3cret");
    expect(result.ok).toBe(true);
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "admin@example.com",
      password: "s3cret",
    });
  });

  it("reports a wrong password without throwing or logging it", async () => {
    const supabase = fakeSupabase(profile("super_admin", "approved", null));
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: null,
      error: { message: "Invalid login credentials", status: 400, name: "AuthApiError" },
    } as never);
    const result = await verifyPassword(supabase, "admin@example.com", "w-r-o-n-g");
    expect(result).toEqual({ ok: false });
  });
});