import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as reauthPost } from "@/app/api/admin/reauth/route";
import { GET as statusGet } from "@/app/api/admin/status/route";
import * as security from "@/server/admin/security";
import { logAdminAction } from "@/server/admin/audit";
import {
  AdminReauthRequiredError,
  ForbiddenError,
  UnauthorizedError,
} from "@/server/errors";

vi.mock("@/server/admin/security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/security")>();
  return {
    ...actual,
    requireAdminIdentity: vi.fn(),
    requireAdmin: vi.fn(),
    markAdminVerified: vi.fn(),
    clearAdminVerified: vi.fn(),
    verifyPassword: vi.fn(),
  };
});

vi.mock("@/server/admin/audit", () => ({
  logAdminAction: vi.fn(),
  insertAuditLog: vi.fn(),
  sanitizeMetadata: vi.fn(),
}));

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_EMAIL = "admin@example.com";
const VERIFIED_AT = new Date().toISOString();

const IDENTITY_CTX = {
  supabase: {},
  service: {},
  user: { id: ADMIN_ID, email: ADMIN_EMAIL },
  profile: { role: "admin" as const, admin_verified_at: VERIFIED_AT },
};

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(security.requireAdminIdentity).mockResolvedValue(IDENTITY_CTX as never);
  vi.mocked(logAdminAction).mockResolvedValue(true);
});

describe("GET /api/admin/status (every admin route must use requireAdmin)", () => {
  it("grants an admin whose window is active", async () => {
    vi.mocked(security.requireAdmin).mockResolvedValue({
      ...IDENTITY_CTX,
      verifiedAt: VERIFIED_AT,
      expiresAt: VERIFIED_AT,
    } as never);
    const res = await statusGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.admin).toBe(true);
    expect(body.verifiedAt).toBe(VERIFIED_AT);
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: ADMIN_ID,
        action: "admin.status",
        resourceId: ADMIN_ID,
        success: true,
      })
    );
  });

  it("rejects an unauthenticated caller with 401", async () => {
    vi.mocked(security.requireAdmin).mockRejectedValue(new UnauthorizedError());
    const res = await statusGet();
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
  });

  it("rejects a normal user with 403", async () => {
    vi.mocked(security.requireAdmin).mockRejectedValue(new ForbiddenError());
    const res = await statusGet();
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
  });

  it("requires re-authentication when the 30-second window expired", async () => {
    vi.mocked(security.requireAdmin).mockRejectedValue(new AdminReauthRequiredError());
    const res = await statusGet();
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("reauth_required");
  });

  it("is a no-op audit-wise when access is denied", async () => {
    vi.mocked(security.requireAdmin).mockRejectedValue(new ForbiddenError());
    await statusGet();
    expect(logAdminAction).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/reauth", () => {
  it("restores admin privileges after a correct password check", async () => {
    vi.mocked(security.verifyPassword).mockResolvedValue({ ok: true });
    const res = await reauthPost(jsonRequest({ password: "correct" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.expiresAt).toBe("string");
    expect(security.markAdminVerified).toHaveBeenCalledWith(
      expect.anything(),
      ADMIN_ID,
      expect.any(String)
    );
    expect(security.clearAdminVerified).not.toHaveBeenCalled();
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: ADMIN_ID,
        action: "admin.reauth",
        resourceType: "user",
        resourceId: ADMIN_ID,
        success: true,
      })
    );
  });

  it("does not restore privileges when the password is wrong (and revokes stale elevation)", async () => {
    vi.mocked(security.verifyPassword).mockResolvedValue({ ok: false });
    const res = await reauthPost(jsonRequest({ password: "wrong-password" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("reauth_failed");
    expect(security.markAdminVerified).not.toHaveBeenCalled();
    expect(security.clearAdminVerified).toHaveBeenCalledWith(expect.anything(), ADMIN_ID);
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ success: false })
    );
  });

  it("rejects a normal user before any password check", async () => {
    vi.mocked(security.requireAdminIdentity).mockRejectedValue(new ForbiddenError());
    const res = await reauthPost(jsonRequest({ password: "whatever" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
    expect(security.verifyPassword).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller with 401", async () => {
    vi.mocked(security.requireAdminIdentity).mockRejectedValue(new UnauthorizedError());
    const res = await reauthPost(jsonRequest({ password: "x" }));
    expect(res.status).toBe(401);
  });

  it("rejects a request without a password", async () => {
    const res = await reauthPost(jsonRequest({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation");
    expect(security.verifyPassword).not.toHaveBeenCalled();
  });

  it("rejects an invalid JSON body", async () => {
    const res = await reauthPost(
      new Request("http://localhost/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation");
  });
});

describe("audit logging never stores the submitted password", () => {
  const SECRET = "p4ssword-9-9-9";

  it("leaks nothing to responses or audit entries, including on failure", async () => {
    vi.mocked(security.verifyPassword).mockResolvedValue({ ok: false });
    const res = await reauthPost(jsonRequest({ password: SECRET }));
    expect(res.status).toBe(401);

    const responseText = JSON.stringify(await res.json());
    expect(responseText).not.toContain(SECRET);
    expect(JSON.stringify(vi.mocked(logAdminAction).mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(vi.mocked(security.markAdminVerified).mock.calls)).not.toContain(
      SECRET
    );

    // The password only ever exists transiently as input to GoTrue.
    expect(security.verifyPassword).toHaveBeenCalledWith(
      expect.anything(),
      ADMIN_EMAIL,
      SECRET
    );
  });

  it("never writes the password into a success audit entry either", async () => {
    vi.mocked(security.verifyPassword).mockResolvedValue({ ok: true });
    await reauthPost(jsonRequest({ password: SECRET }));
    const auditCalls = JSON.stringify(vi.mocked(logAdminAction).mock.calls);
    expect(auditCalls).not.toContain(SECRET);
  });
});