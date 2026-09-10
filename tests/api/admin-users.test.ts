import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as usersGet, POST as usersPost } from "@/app/api/admin/users/route";
import { PATCH as userPatch, DELETE as userDelete } from "@/app/api/admin/users/[id]/route";
import { POST as resetPasswordPost } from "@/app/api/admin/users/[id]/reset-password/route";
import * as security from "@/server/admin/security";
import * as testUsers from "@/server/admin/testUsers";
import { logAdminAction } from "@/server/admin/audit";
import { ForbiddenError, UnauthorizedError } from "@/server/errors";

vi.mock("@/server/admin/security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/security")>();
  return {
    ...actual,
    requireAdminIdentity: vi.fn(),
    requireAdmin: vi.fn(),
  };
});

vi.mock("@/server/admin/testUsers", () => ({
  listTestUsers: vi.fn(),
  createTestUser: vi.fn(),
  updateTestUser: vi.fn(),
  deleteTestUser: vi.fn(),
  replaceTestUserCapabilities: vi.fn(),
  resetTestUserPassword: vi.fn(),
}));

vi.mock("@/server/admin/audit", () => ({
  logAdminAction: vi.fn(),
  insertAuditLog: vi.fn(),
  sanitizeMetadata: vi.fn((v: unknown) => v),
}));

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const VERIFIED_AT = new Date().toISOString();

const IDENTITY_CTX = {
  supabase: {},
  service: {},
  user: { id: ADMIN_ID, email: "admin@example.com" },
  profile: {
    role: "super_admin" as const,
    status: "approved" as const,
    admin_verified_at: VERIFIED_AT,
    display_name: null,
  },
};

const SENSITIVE_CTX = {
  ...IDENTITY_CTX,
  verifiedAt: VERIFIED_AT,
  expiresAt: VERIFIED_AT,
};

const TEST_USER = {
  id: TARGET_ID,
  email: "test@example.com",
  displayName: "Test User",
  status: "active" as const,
  isTestUser: true,
  expiresAt: null as string | null,
  createdAt: "2026-09-06T00:00:00.000Z",
  capabilities: ["chat"],
};

const ID_PARAMS = { params: Promise.resolve({ id: TARGET_ID }) };

function jsonRequest(body: unknown, method = "POST"): Request {
  return new Request("http://localhost/api/admin/users", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(logAdminAction).mockResolvedValue(true);
  vi.mocked(security.requireAdminIdentity).mockResolvedValue(IDENTITY_CTX as never);
  vi.mocked(security.requireAdmin).mockResolvedValue(SENSITIVE_CTX as never);
});

function assertNoPasswordValueInAudit(secrets: string[]) {
  const calls = JSON.stringify(vi.mocked(logAdminAction).mock.calls);
  for (const s of secrets) {
    expect(calls).not.toContain(s);
  }
}

describe("GET /api/admin/users (list)", () => {
  it("lists test users for a super_admin", async () => {
    vi.mocked(testUsers.listTestUsers).mockResolvedValue([TEST_USER] as never);
    const res = await usersGet();
    expect(res.status).toBe(200);
    expect((await res.json()).users).toEqual([TEST_USER]);
    expect(testUsers.listTestUsers).toHaveBeenCalledWith(IDENTITY_CTX.service);
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorId: ADMIN_ID, action: "admin.testusers.list" })
    );
  });

  it("rejects an unauthenticated caller (401)", async () => {
    vi.mocked(security.requireAdminIdentity).mockRejectedValue(new UnauthorizedError());
    expect((await usersGet()).status).toBe(401);
  });

  it("rejects a non-super_admin caller (403)", async () => {
    vi.mocked(security.requireAdminIdentity).mockRejectedValue(new ForbiddenError());
    expect((await usersGet()).status).toBe(403);
  });
});

describe("POST /api/admin/users (create)", () => {
  it("creates a test user and never exposes the password in the response", async () => {
    vi.mocked(testUsers.createTestUser).mockResolvedValue(TEST_USER as never);
    const res = await usersPost(
      jsonRequest({
        email: "test@example.com",
        displayName: "Test User",
        password: "s3cret-9-9-9",
        status: "active",
        permissions: ["chat", "models"],
      })
    );
    expect(res.status).toBe(201);
    const bodyText = JSON.stringify(await res.json());
    expect(bodyText).not.toContain("s3cret-9-9-9");
    expect(testUsers.createTestUser).toHaveBeenCalledWith(
      IDENTITY_CTX.service,
      expect.objectContaining({ email: "test@example.com", status: "active" }),
      ADMIN_ID
    );
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorId: ADMIN_ID, action: "admin.testuser.create" })
    );
    assertNoPasswordValueInAudit(["s3cret-9-9-9"]);
  });

  it("rejects an invalid body (bad email / short password)", async () => {
    const res = await usersPost(
      jsonRequest({ email: "nope", displayName: "X", password: "123" })
    );
    expect(res.status).toBe(400);
    expect(testUsers.createTestUser).not.toHaveBeenCalled();
  });

  it("requires the 30-second sensitive window (reauth_required)", async () => {
    vi.mocked(security.requireAdmin).mockRejectedValue(new ForbiddenError());
    const res = await usersPost(
      jsonRequest({ email: "a@b.co", displayName: "A", password: "123456" })
    );
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/admin/users/[id]", () => {
  it("disables a test user (sensitive)", async () => {
    vi.mocked(testUsers.updateTestUser).mockResolvedValue({
      ...TEST_USER,
      status: "disabled",
    } as never);
    const res = await userPatch(jsonRequest({ status: "disabled" }), ID_PARAMS);
    expect(res.status).toBe(200);
    expect(testUsers.updateTestUser).toHaveBeenCalledWith(
      IDENTITY_CTX.service,
      TARGET_ID,
      { status: "disabled" }
    );
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "admin.testuser.update", resourceId: TARGET_ID })
    );
  });

  it("rejects an empty update (400)", async () => {
    const res = await userPatch(jsonRequest({}), ID_PARAMS);
    expect(res.status).toBe(400);
    expect(testUsers.updateTestUser).not.toHaveBeenCalled();
  });

  it("rejects a malformed id (400)", async () => {
    const res = await userPatch(
      jsonRequest({ status: "disabled" }),
      { params: Promise.resolve({ id: "not-a-uuid" }) }
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/admin/users/[id]/reset-password", () => {
  it("resets the password without logging or returning it", async () => {
    const SECRET = "n3w-password-42";
    const res = await resetPasswordPost(jsonRequest({ password: SECRET }), ID_PARAMS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(testUsers.resetTestUserPassword).toHaveBeenCalledWith(
      IDENTITY_CTX.service,
      TARGET_ID,
      SECRET
    );
    assertNoPasswordValueInAudit([SECRET]);
  });

  it("rejects a too-short password (400)", async () => {
    const res = await resetPasswordPost(jsonRequest({ password: "123" }), ID_PARAMS);
    expect(res.status).toBe(400);
    expect(testUsers.resetTestUserPassword).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/users/[id]", () => {
  it("revokes a test user (sensitive, 204)", async () => {
    vi.mocked(testUsers.deleteTestUser).mockResolvedValue(undefined as never);
    const request = new Request("http://localhost/api/admin/users", { method: "DELETE" });
    const res = await userDelete(request, ID_PARAMS);
    expect(res.status).toBe(204);
    expect(testUsers.deleteTestUser).toHaveBeenCalledWith(IDENTITY_CTX.service, TARGET_ID);
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "admin.testuser.delete", resourceId: TARGET_ID })
    );
  });
});