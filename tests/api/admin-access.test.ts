import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { GET as approvalGet, POST as approvalPost } from "@/app/api/admin/approval/route";
import { POST as accountsPost } from "@/app/api/admin/accounts/route";
import { GET as accountGet } from "@/app/api/admin/accounts/[id]/route";
import { GET as aiGet } from "@/app/api/admin/ai/route";
import { GET as auditGet } from "@/app/api/admin/audit/route";
import { GET as systemGet } from "@/app/api/admin/system/route";
import { GET as featuresGet } from "@/app/api/admin/features/route";
import { PUT as featurePut } from "@/app/api/admin/features/[key]/route";
import {
  GET as improvementsGet,
  POST as improvementsPost,
} from "@/app/api/admin/improvements/route";
import { PUT as improvementPut } from "@/app/api/admin/improvements/[id]/route";
import { GET as usersGet, POST as usersPost } from "@/app/api/admin/users/route";

import * as security from "@/server/admin/security";
import * as featuresRegistry from "@/server/features/registry";
import { ForbiddenError, UnauthorizedError } from "@/server/errors";

vi.mock("@/server/admin/security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/security")>();
  return {
    ...actual,
    requireAdminIdentity: vi.fn(),
    requireAdmin: vi.fn(),
  };
});

vi.mock("@/server/features/registry", () => ({
  listFeatures: vi.fn(),
  updateFeature: vi.fn(),
}));

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const VERIFIED_AT = new Date().toISOString();

const SUPER_ADMIN_CTX = {
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

const ELEVATED_CTX = {
  ...SUPER_ADMIN_CTX,
  verifiedAt: VERIFIED_AT,
  expiresAt: VERIFIED_AT,
};

function jsonRequest(body: unknown, method = "POST"): Request {
  return new Request("http://localhost/api/admin", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* Handlers wrapped with fixed arguments, each returning Promise<Response>. */
const approvalGetReq = () =>
  approvalGet(new Request("http://localhost/api/admin/approval?status=pending") as unknown as NextRequest);
const approvalPostReq = () => approvalPost(jsonRequest({ userId: TARGET_ID, status: "approved" }));
const usersGetReq = () => usersGet();
const usersPostReq = () =>
  usersPost(jsonRequest({ email: "a@b.co", displayName: "A", password: "123456" }));
const accountsPostReq = () => accountsPost(jsonRequest({ query: "alice" }));
const accountGetReq = () =>
  accountGet(new Request("http://localhost/"), {
    params: Promise.resolve({ id: TARGET_ID }),
  });
const aiGetReq = () => aiGet();
const auditGetReq = () => auditGet();
const systemGetReq = () => systemGet();
const featuresGetReq = () => featuresGet();
const featurePutReq = () =>
  featurePut(jsonRequest({ enabled: false }), { params: Promise.resolve({ key: "k" }) });
const improvementsGetReq = () => improvementsGet();
const improvementsPostReq = () => improvementsPost(jsonRequest({ title: "T", body: "B" }));
const improvementPutReq = () =>
  improvementPut(jsonRequest({ action: "approved" }), {
    params: Promise.resolve({ id: TARGET_ID }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(security.requireAdminIdentity).mockResolvedValue(SUPER_ADMIN_CTX as never);
  vi.mocked(security.requireAdmin).mockResolvedValue(ELEVATED_CTX as never);
});

async function expectForbidden(run: () => Promise<Response>) {
  const res = await run();
  expect(res.status).toBe(403);
  const body = await res.json();
  expect(body.error.code).toBe("forbidden");
}

async function expectUnauthorized(run: () => Promise<Response>) {
  const res = await run();
  expect(res.status).toBe(401);
  const body = await res.json();
  expect(body.error.code).toBe("unauthorized");
}

/**
 * Every admin API route must start with a server-side super_admin guard. A
 * signed-in non-super_admin (user, pending/rejected/disabled account, or
 * legacy 'admin' role) must get 403 — the UI is never the security boundary.
 */
describe("admin API authorization (server-side super_admin gates)", () => {
  it.each([
    ["approval GET", approvalGetReq],
    ["approval POST", approvalPostReq],
    ["accounts POST", accountsPostReq],
    ["account GET [id]", accountGetReq],
    ["ai GET", aiGetReq],
    ["audit GET", auditGetReq],
    ["system GET", systemGetReq],
    ["features GET", featuresGetReq],
    ["features PUT [key]", featurePutReq],
    ["improvements GET", improvementsGetReq],
    ["improvements POST", improvementsPostReq],
    ["improvement PUT [id]", improvementPutReq],
    ["users GET", usersGetReq],
    ["users POST", usersPostReq],
  ])("denies %s a non-super_admin caller with 403", async (_label, run) => {
    vi.mocked(security.requireAdminIdentity).mockRejectedValue(new ForbiddenError());
    vi.mocked(security.requireAdmin).mockRejectedValue(new ForbiddenError());
    await expectForbidden(run);
  });

  it("rejects a blocked account (pending / rejected / disabled) on every route", async () => {
    vi.mocked(security.requireAdminIdentity).mockRejectedValue(new ForbiddenError());
    vi.mocked(security.requireAdmin).mockRejectedValue(new ForbiddenError());

    await expectForbidden(approvalGetReq);
    await expectForbidden(usersGetReq);
    await expectForbidden(featurePutReq);
  });

  it("rejects an unauthenticated caller with 401 (fail closed)", async () => {
    vi.mocked(security.requireAdminIdentity).mockRejectedValue(new UnauthorizedError());
    vi.mocked(security.requireAdmin).mockRejectedValue(new UnauthorizedError());
    await expectUnauthorized(aiGetReq);
    await expectUnauthorized(approvalGetReq);
  });

  it("grants an approved super_admin identity (read-only route)", async () => {
    vi.mocked(featuresRegistry.listFeatures).mockResolvedValue([] as never);
    const res = await featuresGetReq();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.features).toEqual([]);
    expect(security.requireAdminIdentity).toHaveBeenCalled();
  });
});