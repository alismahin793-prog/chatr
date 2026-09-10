import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_GROUPS,
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
  } as unknown as SupabaseClient<Database>;
}

function mockIdentity(profile: {
  role: string;
  status: string;
  admin_verified_at: string | null;
}) {
  const supabase = fakeSupabase(profile);
  vi.mocked(requireUser).mockResolvedValue({ supabase, user: USER } as never);
  const service = {} as SupabaseClient<Database>;
  vi.mocked(createServiceClient).mockReturnValue(service);
  return { supabase, service };
}

function serviceWithPermissions(granted: string[], role = "admin") {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { role }, error: null }),
            }),
          }),
        };
      }
      const maybeSingle = vi.fn().mockResolvedValue(
        granted.length > 0
          ? { data: { permission: granted[0] }, error: null }
          : { data: null, error: null }
      );
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ maybeSingle }),
          }),
        }),
      };
    }),
  } as unknown as SupabaseClient<Database>;
}

const ACTIVE_VERIFIED = new Date().toISOString();

/** Role returned by the fake profiles select, so we can exercise super_admin. */
let profileRoleValue: string | null = "admin";

/**
 * Service client whose profiles select returns the configured role and whose
 * admin_permissions select returns the provided rows.
 */
function tableAwareService(adminRows: { permission: string }[] | null) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { role: profileRoleValue },
                error: null,
              }),
            }),
          }),
        };
      }
      const headers = { data: adminRows, error: null };
      const row = adminRows?.[0] ?? null;
      const rowResult = { data: row, error: null };
      const secondEq = { maybeSingle: vi.fn().mockResolvedValue(rowResult) };
      const builder = {
        eq: vi.fn().mockReturnValue(secondEq),
        maybeSingle: vi.fn().mockResolvedValue(rowResult),
        then: (onFulfilled: (value: unknown) => unknown) =>
          Promise.resolve(headers).then(onFulfilled),
      };
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue(builder),
        }),
      };
    }),
  } as unknown as SupabaseClient<Database>;
}

/** Service client whose every table answers maybeSingle with the given data. */
function serviceFlat(role: string) {
  return {
    from: vi.fn().mockImplementation((table: string) => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi
            .fn()
            .mockResolvedValue({
              data: table === "profiles" ? { role } : null,
              error: null,
            }),
        }),
      }),
    })),
  } as unknown as SupabaseClient<Database>;
}

beforeEach(() => {
  vi.clearAllMocks();
  profileRoleValue = "admin";
});

describe("permission catalog", () => {
  it("defines exactly the documented 20 permissions", () => {
    expect(ALL_PERMISSIONS).toHaveLength(20);
    expect(new Set(ALL_PERMISSIONS).size).toBe(20);
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
      "manage_features",
    ];
    expect([...SENSITIVE_PERMISSIONS].sort()).toEqual(expected.sort());
  });

  it("does not treat read-only permissions as sensitive", () => {
    expect(isSensitivePermission(PERMISSIONS.VIEW_USERS)).toBe(false);
    expect(isSensitivePermission(PERMISSIONS.VIEW_AUDIT_LOGS)).toBe(false);
    expect(isSensitivePermission(PERMISSIONS.CREATE_DEV_REQUESTS)).toBe(false);
  });

  it("treats manage_features as sensitive", () => {
    expect(isSensitivePermission(PERMISSIONS.MANAGE_FEATURES)).toBe(true);
  });
});

describe("isValidPermission", () => {
  it("accepts known permission strings", () => {
    expect(isValidPermission("view_users")).toBe(true);
    expect(isValidPermission("approve_deployments")).toBe(true);
    expect(isValidPermission("manage_features")).toBe(true);
  });

  it("rejects unknown or empty values", () => {
    expect(isValidPermission("view_everything")).toBe(false);
    expect(isValidPermission("admin")).toBe(false);
    expect(isValidPermission("")).toBe(false);
  });
});

describe("getUserPermissions", () => {
  it("reads and filters granted permissions from admin_permissions", async () => {
    const service = tableAwareService([
      { permission: "view_users" },
      { permission: "not-a-real-permission" },
      { permission: "view_audit_logs" },
    ]);

    const perms = await getUserPermissions(service, ADMIN_ID);
    expect(perms).toEqual(["view_users", "view_audit_logs"]);
  });

  it("returns an empty array when nothing is granted or data is null", async () => {
    const service = tableAwareService(null);
    expect(await getUserPermissions(service, ADMIN_ID)).toEqual([]);
  });

  it("returns every permission for a super_admin without explicit rows", async () => {
    profileRoleValue = "super_admin";
    const perms = await getUserPermissions(tableAwareService(null), ADMIN_ID);
    expect(perms).toEqual([...ALL_PERMISSIONS]);
  });

  it("throws on a database error", async () => {
    const service = {
      from: vi.fn().mockImplementation((table: string) => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: table === "profiles" ? { role: "admin" } : null,
            error: { message: "db" },
          }),
        }),
      })),
    } as unknown as SupabaseClient<Database>;
    await expect(getUserPermissions(service, ADMIN_ID)).rejects.toThrow();
  });
});

describe("hasPermission", () => {
  it("returns true when the row exists", async () => {
    const service = tableAwareService([{ permission: "view_users" }]);
    expect(await hasPermission(service, ADMIN_ID, PERMISSIONS.VIEW_USERS)).toBe(true);
  });

  it("returns false when the row is missing", async () => {
    const service = tableAwareService(null);
    expect(await hasPermission(service, ADMIN_ID, PERMISSIONS.VIEW_USERS)).toBe(false);
  });

  it("returns true for a super_admin even without an explicit row", async () => {
    profileRoleValue = "super_admin";
    const service = tableAwareService(null);
    expect(await hasPermission(service, ADMIN_ID, PERMISSIONS.MANAGE_FEATURES)).toBe(true);
  });
});

describe("requirePermission", () => {
  it("allows an approved super_admin (implicitly holding every permission)", async () => {
    mockIdentity({ role: "super_admin", status: "approved", admin_verified_at: null });
    vi.mocked(createServiceClient).mockReturnValue(serviceFlat("super_admin") as never);
    const ctx = await requirePermission(PERMISSIONS.VIEW_USERS);
    expect(ctx.permission).toBe(PERMISSIONS.VIEW_USERS);
  });

  it("rejects a legacy 'admin' role even when approved (403)", async () => {
    mockIdentity({ role: "admin", status: "approved", admin_verified_at: null });
    const service = serviceWithPermissions(["view_users"]);
    vi.mocked(createServiceClient).mockReturnValue(service);
    await expect(requirePermission(PERMISSIONS.VIEW_USERS)).rejects.toBeInstanceOf(
      ForbiddenError
    );
  });

  it("rejects a super_admin whose account is pending (403)", async () => {
    mockIdentity({ role: "super_admin", status: "pending", admin_verified_at: null });
    vi.mocked(createServiceClient).mockReturnValue(serviceFlat("super_admin") as never);
    await expect(requirePermission(PERMISSIONS.VIEW_USERS)).rejects.toBeInstanceOf(
      ForbiddenError
    );
  });

  it("rejects a normal user (403)", async () => {
    mockIdentity({ role: "user", status: "approved", admin_verified_at: null });
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
  it("allows an approved super_admin with an active re-auth window", async () => {
    mockIdentity({ role: "super_admin", status: "approved", admin_verified_at: ACTIVE_VERIFIED });
    vi.mocked(createServiceClient).mockReturnValue(serviceFlat("super_admin") as never);
    const ctx = await requireSensitivePermission(PERMISSIONS.MANAGE_USER_ROLES);
    expect(ctx.permission).toBe(PERMISSIONS.MANAGE_USER_ROLES);
  });

  it("requires a fresh re-auth window even for a super_admin", async () => {
    const stale = new Date(Date.now() - 31_000).toISOString();
    mockIdentity({ role: "super_admin", status: "approved", admin_verified_at: stale });
    vi.mocked(createServiceClient).mockReturnValue(serviceFlat("super_admin") as never);
    await expect(
      requireSensitivePermission(PERMISSIONS.MANAGE_USER_ROLES)
    ).rejects.toBeInstanceOf(AdminReauthRequiredError);
  });

  it("requires re-authentication when the super_admin never verified", async () => {
    mockIdentity({ role: "super_admin", status: "approved", admin_verified_at: null });
    vi.mocked(createServiceClient).mockReturnValue(serviceFlat("super_admin") as never);
    await expect(
      requireSensitivePermission(PERMISSIONS.MANAGE_USER_ROLES)
    ).rejects.toBeInstanceOf(AdminReauthRequiredError);
  });

  it("rejects a pending super_admin even inside an active window", async () => {
    mockIdentity({ role: "super_admin", status: "pending", admin_verified_at: ACTIVE_VERIFIED });
    vi.mocked(createServiceClient).mockReturnValue(serviceFlat("super_admin") as never);
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
    const service = tableAwareService([
      { permission: "view_users" },
      { permission: "view_audit_logs" },
      { permission: "manage_features" },
    ]);
    vi.mocked(createServiceClient).mockReturnValue(service);

    const groups = await getGrantedPermissionGroups(ADMIN_ID);
    expect(groups).toEqual([
      { key: "USER_MANAGEMENT", label: "User Management" },
      { key: "SECURITY", label: "Security" },
      { key: "FEATURES", label: "Features" },
    ]);
  });

  it("returns all groups for a super_admin without explicit rows", async () => {
    profileRoleValue = "super_admin";
    vi.mocked(createServiceClient).mockReturnValue(tableAwareService(null));

    const groups = await getGrantedPermissionGroups(ADMIN_ID);
    expect(groups.map((g) => g.key).sort()).toEqual(
      Object.keys(PERMISSION_GROUPS).sort()
    );
  });

  it("returns an empty list when nothing is granted", async () => {
    const service = tableAwareService([]);
    vi.mocked(createServiceClient).mockReturnValue(service);
    expect(await getGrantedPermissionGroups(ADMIN_ID)).toEqual([]);
  });
});