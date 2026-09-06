import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  SENSITIVE_PERMISSIONS,
  getGrantedPermissionGroups,
  getUserPermissions,
  grantPermission,
  hasPermission,
  isSensitivePermission,
  isValidPermission,
  requirePermission,
  requireSensitivePermission,
  revokePermission,
} from "@/server/admin/permissions";
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

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";

const USER: User = {
  id: ADMIN_ID,
  email: "admin@example.com",
} as User;

function fakeSupabase(profile: {
  role: string | null;
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
  } as unknown as SupabaseClient<Database>;
}

function mockIdentity(profile: { role: string; admin_verified_at: string | null }) {
  const supabase = fakeSupabase(profile);
  vi.mocked(requireUser).mockResolvedValue({ supabase, user: USER } as never);
  const service = {} as SupabaseClient<Database>;
  vi.mocked(createServiceClient).mockReturnValue(service);
  return { supabase, service };
}

function serviceWithPermissions(granted: string[]) {
  const maybeSingle = vi.fn().mockResolvedValue(
    granted.length > 0
      ? { data: { permission: granted[0] }, error: null }
      : { data: null, error: null }
  );
  const service = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle }),
        }),
      }),
    }),
  } as unknown as SupabaseClient<Database>;
  return service;
}

const ACTIVE_VERIFIED = new Date().toISOString();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("permission catalog", () => {
  it("defines exactly the documented 19 permissions", () => {
    expect(ALL_PERMISSIONS).toHaveLength(19);
    expect(new Set(ALL_PERMISSIONS).size).toBe(19);
  });

  it("classifies the document's sensitive permissions", () => {
    const expected = [
      "disable_users",
      "manage_user_roles",
      "manage_provider_availability",
      "manage_usage_limits",
      "manage_app_settings",
      "revoke_user_sessions",
      "approve_dev_plans",
      "approve_deployments",
    ];
    expect([...SENSITIVE_PERMISSIONS].sort()).toEqual(expected.sort());
  });

  it("does not treat read-only permissions as sensitive", () => {
    expect(isSensitivePermission(PERMISSIONS.VIEW_USERS)).toBe(false);
    expect(isSensitivePermission(PERMISSIONS.VIEW_AUDIT_LOGS)).toBe(false);
    expect(isSensitivePermission(PERMISSIONS.CREATE_DEV_REQUESTS)).toBe(false);
  });
});

describe("isValidPermission", () => {
  it("accepts known permission strings", () => {
    expect(isValidPermission("view_users")).toBe(true);
    expect(isValidPermission("approve_deployments")).toBe(true);
  });

  it("rejects unknown or empty values", () => {
    expect(isValidPermission("view_everything")).toBe(false);
    expect(isValidPermission("admin")).toBe(false);
    expect(isValidPermission("")).toBe(false);
  });
});

describe("getUserPermissions", () => {
  it("reads and filters granted permissions from admin_permissions", async () => {
    const service = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [
              { permission: "view_users" },
              { permission: "not-a-real-permission" },
              { permission: "view_audit_logs" },
            ],
            error: null,
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    const perms = await getUserPermissions(service, ADMIN_ID);
    expect(perms).toEqual(["view_users", "view_audit_logs"]);
  });

  it("returns an empty array when nothing is granted or data is null", async () => {
    const service = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;
    expect(await getUserPermissions(service, ADMIN_ID)).toEqual([]);
  });

  it("throws on a database error", async () => {
    const service = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: { message: "db" } }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;
    await expect(getUserPermissions(service, ADMIN_ID)).rejects.toThrow();
  });
});

describe("hasPermission", () => {
  function serviceWithRow(permission: { permission: string } | null) {
    return {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi
              .fn()
              .mockReturnValue({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: permission, error: null }),
              }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;
  }

  it("returns true when the row exists", async () => {
    const service = serviceWithRow({ permission: "view_users" });
    expect(await hasPermission(service, ADMIN_ID, PERMISSIONS.VIEW_USERS)).toBe(true);
  });

  it("returns false when the row is missing", async () => {
    const service = serviceWithRow(null);
    expect(await hasPermission(service, ADMIN_ID, PERMISSIONS.VIEW_USERS)).toBe(false);
  });
});

describe("requirePermission", () => {
  it("allows an admin holding the permission, without needing a re-auth window", async () => {
    mockIdentity({ role: "admin", admin_verified_at: null });
    const service = serviceWithPermissions(["view_users"]);
    vi.mocked(createServiceClient).mockReturnValue(service);
    const ctx = await requirePermission(PERMISSIONS.VIEW_USERS);
    expect(ctx.permission).toBe(PERMISSIONS.VIEW_USERS);
  });

  it("rejects an admin who lacks the permission (403)", async () => {
    mockIdentity({ role: "admin", admin_verified_at: null });
    const service = serviceWithPermissions([]);
    vi.mocked(createServiceClient).mockReturnValue(service);
    await expect(requirePermission(PERMISSIONS.VIEW_USERS)).rejects.toBeInstanceOf(
      ForbiddenError
    );
  });

  it("rejects a normal user even if a permission row existed", async () => {
    mockIdentity({ role: "user", admin_verified_at: null });
    const service = serviceWithPermissions(["view_users"]);
    vi.mocked(createServiceClient).mockReturnValue(service);
    await expect(requirePermission(PERMISSIONS.VIEW_USERS)).rejects.toBeInstanceOf(
      ForbiddenError
    );
  });

  it("propagates unauthenticated callers", async () => {
    vi.mocked(requireUser).mockRejectedValue(new UnauthorizedError());
    await expect(requirePermission(PERMISSIONS.VIEW_USERS)).rejects.toBeInstanceOf(
      UnauthorizedError
    );
  });
});

describe("requireSensitivePermission", () => {
  it("allows an admin holding the permission with an active window", async () => {
    mockIdentity({ role: "admin", admin_verified_at: ACTIVE_VERIFIED });
    const service = serviceWithPermissions(["manage_user_roles"]);
    vi.mocked(createServiceClient).mockReturnValue(service);
    const ctx = await requireSensitivePermission(PERMISSIONS.MANAGE_USER_ROLES);
    expect(ctx.permission).toBe(PERMISSIONS.MANAGE_USER_ROLES);
  });

  it("requires a fresh re-auth window even when the permission is held", async () => {
    const stale = new Date(Date.now() - 31_000).toISOString();
    mockIdentity({ role: "admin", admin_verified_at: stale });
    const service = serviceWithPermissions(["manage_user_roles"]);
    vi.mocked(createServiceClient).mockReturnValue(service);
    await expect(
      requireSensitivePermission(PERMISSIONS.MANAGE_USER_ROLES)
    ).rejects.toBeInstanceOf(AdminReauthRequiredError);
  });

  it("rejects an admin who lacks the permission even inside the window", async () => {
    mockIdentity({ role: "admin", admin_verified_at: ACTIVE_VERIFIED });
    const service = serviceWithPermissions([]);
    vi.mocked(createServiceClient).mockReturnValue(service);
    await expect(
      requireSensitivePermission(PERMISSIONS.MANAGE_USER_ROLES)
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("grantPermission / revokePermission", () => {
  function mutationService() {
    return {
      from: vi.fn().mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ error: null }),
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;
  }

  it("upserts a grant idempotently via the service role", async () => {
    const service = mutationService();
    await grantPermission(service, TARGET_ID, PERMISSIONS.VIEW_USERS, ADMIN_ID);
    expect(service.from).toHaveBeenCalledWith("admin_permissions");
    const { upsert } = service.from("");
    expect(upsert).toHaveBeenCalledWith(
      {
        user_id: TARGET_ID,
        permission: "view_users",
        granted_by: ADMIN_ID,
      },
      { onConflict: "user_id,permission", ignoreDuplicates: true }
    );
  });

  it("rejects an unknown permission with a forbidden error", async () => {
    const service = mutationService();
    await expect(
      grantPermission(service, TARGET_ID, "view_everything" as never, ADMIN_ID)
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("deletes a grant through the service role", async () => {
    const service = mutationService();
    await revokePermission(service, TARGET_ID, PERMISSIONS.VIEW_USERS);
    const { delete: del } = service.from("");
    expect(del).toHaveBeenCalled();
  });
});

describe("getGrantedPermissionGroups", () => {
  it("returns only groups with at least one granted permission", async () => {
    const service = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [
              { permission: "view_users" },
              { permission: "view_audit_logs" },
            ],
            error: null,
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;
    vi.mocked(createServiceClient).mockReturnValue(service);

    const groups = await getGrantedPermissionGroups(ADMIN_ID);
    expect(groups).toEqual([
      { key: "USER_MANAGEMENT", label: "User Management" },
      { key: "SECURITY", label: "Security" },
    ]);
  });

  it("returns an empty list when nothing is granted", async () => {
    const service = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;
    vi.mocked(createServiceClient).mockReturnValue(service);
    expect(await getGrantedPermissionGroups(ADMIN_ID)).toEqual([]);
  });
});