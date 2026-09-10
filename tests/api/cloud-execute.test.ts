import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listGet, POST as executePost } from "@/app/api/admin/cloud/execute/route";
import * as security from "@/server/admin/security";
import * as cloudService from "@/server/cloud/service";
import {
  AdminReauthRequiredError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "@/server/errors";

/**
 * Auth contract for the sensitive execution gate. Execution mutates a
 * workspace — it MUST require a super_admin identity AND a fresh 30-second
 * re-auth window, and it must never leak which code path ran to an
 * unauthorized caller.
 */
vi.mock("@/server/admin/security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/security")>();
  return {
    ...actual,
    requireAdminIdentity: vi.fn(),
    requireAdmin: vi.fn(),
  };
});

vi.mock("@/server/cloud/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/cloud/service")>();
  return {
    ...actual,
    getProjectOrThrow: vi.fn(),
    listOperations: vi.fn(),
    createOperation: vi.fn(),
    touchProject: vi.fn(),
    assertProjectActive: vi.fn(),
    finishOperation: vi.fn(),
    getOperation: vi.fn(),
  };
});

vi.mock("@/server/admin/audit", () => ({
  logAdminAction: vi.fn(),
  insertAuditLog: vi.fn(),
  sanitizeMetadata: vi.fn(),
}));

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_CTX = {
  supabase: {},
  service: {},
  user: { id: ADMIN_ID, email: ADMIN_EMAIL },
  profile: { role: "super_admin", status: "approved", admin_verified_at: new Date().toISOString() },
  verifiedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 30_000).toISOString(),
} as never;

function executeBody(): Request {
  return new Request("http://localhost/api/admin/cloud/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: "22222222-2222-4222-8222-222222222222", command: "git status" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  const t = vi.mocked(security.requireAdmin);
  t.mockImplementation(async () => ADMIN_CTX);
  vi.mocked(security.requireAdminIdentity).mockImplementation(async () => ADMIN_CTX as never);
  vi.mocked(cloudService.getProjectOrThrow).mockRejectedValue(new NotFoundError());
});

describe("POST /api/admin/cloud/execute (sensitive gate)", () => {
  it("rejects an unauthenticated caller with 401", async () => {
    vi.mocked(security.requireAdmin).mockRejectedValueOnce(new UnauthorizedError());
    const res = await executePost(executeBody());
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
  });

  it("rejects a signed-in non-super-admin with 403", async () => {
    vi.mocked(security.requireAdmin).mockRejectedValueOnce(new ForbiddenError());
    const res = await executePost(executeBody());
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
  });

  it("rejects when the 30-second re-auth window expired", async () => {
    vi.mocked(security.requireAdmin).mockRejectedValueOnce(new AdminReauthRequiredError());
    const res = await executePost(executeBody());
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("reauth_required");
  });

  it("does not read the body or touch the DB when access is denied", async () => {
    vi.mocked(security.requireAdmin).mockRejectedValueOnce(new ForbiddenError());
    const res = await executePost(executeBody());
    expect(res.status).toBe(403);
    expect(cloudService.getProjectOrThrow).not.toHaveBeenCalled();
  });

  it("lets an approved super_admin past the gate to project validation", async () => {
    const res = await executePost(executeBody());
    // Auth passed; the request proceeded to the DB lookup (mock returns 404).
    expect(res.status).toBe(404);
    expect(cloudService.getProjectOrThrow).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/admin/cloud/execute/operations (read gate)", () => {
  it("requires a super_admin identity (401 on anonymous)", async () => {
    vi.mocked(security.requireAdminIdentity).mockRejectedValueOnce(new UnauthorizedError());
    const res = await listGet(new Request("http://localhost/api/admin/cloud/execute/operations"));
    expect(res.status).toBe(401);
  });

  it("rejects non-super-admin identities with 403", async () => {
    vi.mocked(security.requireAdminIdentity).mockRejectedValueOnce(new ForbiddenError());
    const res = await listGet(new Request("http://localhost/api/admin/cloud/execute/operations"));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
  });

  it("lists operations for an authorized super_admin (empty history)", async () => {
    vi.mocked(cloudService.listOperations).mockResolvedValue([] as never);
    const res = await listGet(new Request("http://localhost/api/admin/cloud/execute/operations"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.operations).toEqual([]);
  });
});