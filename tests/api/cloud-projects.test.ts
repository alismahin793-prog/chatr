import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listGet, POST as createPost } from "@/app/api/admin/cloud/projects/route";
import {
  DELETE as projectDelete,
  GET as projectGet,
  PATCH as projectPatch,
} from "@/app/api/admin/cloud/projects/[id]/route";
import * as security from "@/server/admin/security";
import * as cloudService from "@/server/cloud/service";
import { UnauthorizedError } from "@/server/errors";

/**
 * The Cloud Development projects API contract: every read/mutation returns
 * the SAME camelCase serializable project shape that the client components
 * consume (CloudProjectsManager/Project, CloudProjectOverview/ProjectDetail).
 * A shape drift here previously made the list page crash after the first
 * project creation, so the serialization is pinned here.
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
    listProjects: vi.fn(),
    createProject: vi.fn(),
    getProjectOrThrow: vi.fn(),
    updateProject: vi.fn(),
    setProjectStatus: vi.fn(),
  };
});

vi.mock("@/server/admin/audit", () => ({
  logAdminAction: vi.fn(),
  insertAuditLog: vi.fn(),
  sanitizeMetadata: vi.fn(),
}));

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_CTX = {
  supabase: {},
  service: {},
  user: { id: ADMIN_ID, email: "admin@example.com" },
  profile: { role: "super_admin", status: "approved", admin_verified_at: new Date().toISOString() },
  verifiedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 30_000).toISOString(),
} as never;

/** A raw snake_case DB row as returned by Supabase before serialization. */
function rowFixture() {
  return {
    id: PROJECT_ID,
    name: "Test Project",
    slug: "test-project",
    description: "A test project",
    status: "active",
    repo_url: null,
    default_branch: "main",
    base_env: "development",
    last_build_status: "never",
    last_deployment_status: "never",
    env_vars: [{ name: "FOO", configured: true, updatedAt: "2026-01-01T00:00:00.000Z" }],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    last_activity_at: "2026-01-03T00:00:00.000Z",
  } as never;
}

function projectParams() {
  return { params: Promise.resolve({ id: PROJECT_ID }) };
}

function json(body: unknown, method = "POST"): Request {
  return new Request(`http://localhost/api/admin/cloud/projects${method === "DELETE" ? `/${PROJECT_ID}` : ""}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(security.requireAdminIdentity).mockImplementation(async () => ADMIN_CTX);
  vi.mocked(security.requireAdmin).mockImplementation(async () => ADMIN_CTX);
  vi.mocked(cloudService.listProjects).mockResolvedValue([rowFixture()]);
  vi.mocked(cloudService.createProject).mockResolvedValue(rowFixture());
  vi.mocked(cloudService.getProjectOrThrow).mockResolvedValue(rowFixture());
  vi.mocked(cloudService.updateProject).mockResolvedValue(rowFixture());
  vi.mocked(cloudService.setProjectStatus).mockResolvedValue(rowFixture());
});

function expectCamelCase(project: Record<string, unknown>) {
  expect(project.lastBuildStatus).toBe("never");
  expect(project.lastDeploymentStatus).toBe("never");
  expect(project.repoUrl).toBeNull();
  expect(project.defaultBranch).toBe("main");
  expect(project.baseEnv).toBe("development");
  expect(project.createdAt).toBe("2026-01-01T00:00:00.000Z");
  expect(project.updatedAt).toBe("2026-01-02T00:00:00.000Z");
  expect(project.lastActivityAt).toBe("2026-01-03T00:00:00.000Z");
  expect(project.envVarNames).toEqual(["FOO"]);
  expect(project.envVarCount).toBe(1);
  expect("last_build_status" in project).toBe(false);
  expect("last_deployment_status" in project).toBe(false);
  expect("created_at" in project).toBe(false);
  expect("updated_at" in project).toBe(false);
}

describe("GET /api/admin/cloud/projects (list)", () => {
  it("rejects an unauthenticated caller with 401 and does not list rows", async () => {
    vi.mocked(security.requireAdminIdentity).mockRejectedValueOnce(new UnauthorizedError());
    const res = await listGet();
    expect(res.status).toBe(401);
    expect(cloudService.listProjects).not.toHaveBeenCalled();
  });

  it("returns camelCase serialized projects", async () => {
    const res = await listGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toHaveLength(1);
    expectCamelCase(body.projects[0]);
  });
});

describe("GET /api/admin/cloud/projects/:id (detail)", () => {
  it("returns camelCase serialized project", async () => {
    const res = await projectGet(new Request("http://localhost/api/admin/cloud/projects/x"), projectParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expectCamelCase(body.project);
  });
});

describe("POST /api/admin/cloud/projects (create)", () => {
  it("keeps the existing camelCase contract and requires the re-auth window", async () => {
    const res = await createPost(json({ name: "Test Project", slug: "test-project" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expectCamelCase(body.project);
    expect(security.requireAdmin).toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/cloud/projects/:id (update)", () => {
  it("returns camelCase serialized project", async () => {
    const res = await projectPatch(json({ name: "Renamed" }, "PATCH"), projectParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expectCamelCase(body.project);
    expect(cloudService.updateProject).toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/cloud/projects/:id (archive)", () => {
  it("returns camelCase serialized project", async () => {
    const res = await projectDelete(json({}, "DELETE"), projectParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expectCamelCase(body.project);
    expect(cloudService.setProjectStatus).toHaveBeenCalledWith(expect.anything(), PROJECT_ID, "archived");
  });
});