import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DELETE as permissionsDelete,
  GET as permissionsGet,
  POST as permissionsPost,
} from "@/app/api/admin/permissions/route";
import * as permissions from "@/server/admin/permissions";
import * as security from "@/server/admin/security";
import { logAdminAction } from "@/server/admin/audit";
import {
  AdminReauthRequiredError,
  ForbiddenError,
  UnauthorizedError,
} from "@/server/errors";

vi.mock("@/server/admin/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/permissions")>();
  return {
    ...actual,
    requireSensitivePermission: vi.fn(),
    grantPermission: vi.fn(),
    revokePermission: vi.fn(),
  };
});

vi.mock("@/server/admin/security", () => ({
  requireAdminIdentity: vi.fn(),
  requireAdmin: vi.fn(),
  markAdminVerified: vi.fn(),
  clearAdminVerified: vi.fn(),
  verifyPassword: vi.fn(),
  adminWindowStatus: vi.fn(),
  ADMIN_ROLE: "admin",
  USER_ROLE: "user",
  ADMIN_SESSION_TTL_MS: 30_000,
  ADMIN_SESSION_TTL_SECONDS: 30,
}));

vi.mock("@/server/admin/audit", () => ({
  logAdminAction: vi.fn(),
  insertAuditLog: vi.fn(),
  sanitizeMetadata: vi.fn(),
}));

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const VERIFIED_AT = new Date().toISOString();

const IDENTITY_CTX = {
  supabase: {},
  service: {},
  user: { id: ADMIN_ID, email: "admin@example.com" },
  profile: { role: "admin" as const, admin_verified_at: VERIFIED_AT },
};

const SENSITIVE_CTX = {
  ...IDENTITY_CTX,
  verifiedAt: VERIFIED_AT,
  expiresAt: VERIFIED_AT,
};

function jsonRequest(body: unknown, method = "POST"): Request {
  return new Request("http://localhost/api/admin/permissions", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(logAdminAction).mockResolvedValue(true);
});

describe("GET /api/admin/permissions", () => {
  beforeEach(() => {
    vi.mocked(security.requireAdminIdentity).mockResolvedValue(IDENTITY_CTX as never);
    (IDENTITY_CTX.service as { from: unknown }).from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: [
            { user_id: ADMIN_ID, permission: "view_users" },
            { user_id: ADMIN_ID, permission: "view_audit_logs" },
          ],
          error: null,
        }),
      }),
    });
  });

  it("returns the caller's own granted permissions", async () => {
    const res = await permissionsGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.permissions).toEqual(["view_users", "view_audit_logs"]);
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorId: ADMIN_ID, action: "admin.permissions.list" })
    );
  });

  it("returns an empty list when the admin has no grants", async () => {
    (IDENTITY_CTX.service as { from: unknown }).from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });
    const res = await permissionsGet();
    expect((await res.json()).permissions).toEqual([]);
  });

  it("rejects an unauthenticated caller", async () => {
    vi.mocked(security.requireAdminIdentity).mockRejectedValue(
      new UnauthorizedError()
    );
    const res = await permissionsGet();
    expect(res.status).toBe(401);
  });

  it("rejects a normal user", async () => {
    vi.mocked(security.requireAdminIdentity).mockRejectedValue(
      new ForbiddenError()
    );
    const res = await permissionsGet();
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/permissions (grant)", () => {
  beforeEach(() => {
    vi.mocked(permissions.requireSensitivePermission).mockResolvedValue(
      SENSITIVE_CTX as never
    );
    vi.mocked(permissions.grantPermission).mockResolvedValue();
  });

  it("grants a valid permission and audits it", async () => {
    const res = await permissionsPost(
      jsonRequest({ userId: TARGET_ID, permission: "view_users" })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      userId: TARGET_ID,
      permission: "view_users",
    });
    expect(permissions.grantPermission).toHaveBeenCalledWith(
      expect.anything(),
      TARGET_ID,
      "view_users",
      ADMIN_ID
    );
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: ADMIN_ID,
        action: "admin.permissions.grant",
        resourceType: "user",
        resourceId: TARGET_ID,
        success: true,
        metadata: { permission: "view_users" },
      })
    );
  });

  it("rejects an unknown permission", async () => {
    const res = await permissionsPost(
      jsonRequest({ userId: TARGET_ID, permission: "view_everything" })
    );
    expect(res.status).toBe(400);
    expect(permissions.grantPermission).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    const res = await permissionsPost(jsonRequest({ userId: "not-a-uuid" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation");
  });

  it("requires the sensitive re-auth gate before granting", async () => {
    vi.mocked(permissions.requireSensitivePermission).mockRejectedValue(
      new AdminReauthRequiredError()
    );
    const res = await permissionsPost(
      jsonRequest({ userId: TARGET_ID, permission: "view_users" })
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("reauth_required");
    expect(permissions.grantPermission).not.toHaveBeenCalled();
  });

  it("rejects an admin without the manage_user_roles permission", async () => {
    vi.mocked(permissions.requireSensitivePermission).mockRejectedValue(
      new ForbiddenError()
    );
    const res = await permissionsPost(
      jsonRequest({ userId: TARGET_ID, permission: "view_users" })
    );
    expect(res.status).toBe(403);
    expect(permissions.grantPermission).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/permissions (revoke)", () => {
  beforeEach(() => {
    vi.mocked(permissions.requireSensitivePermission).mockResolvedValue(
      SENSITIVE_CTX as never
    );
    vi.mocked(permissions.revokePermission).mockResolvedValue();
  });

  it("revokes a valid permission and audits it", async () => {
    const res = await permissionsDelete(
      jsonRequest({ userId: TARGET_ID, permission: "view_users" }, "DELETE")
    );
    expect(res.status).toBe(200);
    expect(permissions.revokePermission).toHaveBeenCalledWith(
      expect.anything(),
      TARGET_ID,
      "view_users"
    );
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "admin.permissions.revoke",
        resourceId: TARGET_ID,
        metadata: { permission: "view_users" },
      })
    );
  });

  it("rejects an unknown permission", async () => {
    const res = await permissionsDelete(
      jsonRequest({ userId: TARGET_ID, permission: "bogus" }, "DELETE")
    );
    expect(res.status).toBe(400);
    expect(permissions.revokePermission).not.toHaveBeenCalled();
  });

  it("requires the sensitive re-auth gate before revoking", async () => {
    vi.mocked(permissions.requireSensitivePermission).mockRejectedValue(
      new AdminReauthRequiredError()
    );
    const res = await permissionsDelete(
      jsonRequest({ userId: TARGET_ID, permission: "view_users" }, "DELETE")
    );
    expect(res.status).toBe(401);
    expect(permissions.revokePermission).not.toHaveBeenCalled();
  });
});