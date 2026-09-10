import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  getFeatureByKey,
  listAvailableFeatures,
  listFeatures,
  updateFeature,
} from "@/server/features/registry";
import { isFeatureEnabled, requireFeature } from "@/server/features/helpers";
import { ForbiddenError, NotFoundError } from "@/server/errors";

const FEATURES = (overrides: Record<string, unknown>[] = []) => {
  const base = [
    {
      id: "f1",
      key: "pdf_analysis",
      name: "PDF Analysis",
      description: "Parse PDFs",
      enabled: true,
      available_to_users: true,
      version: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "f2",
      key: "image_generation",
      name: "Image Generation",
      description: "Generate images",
      enabled: false,
      available_to_users: true,
      version: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ];
  return base.map((row, i) => ({ ...row, ...(overrides[i] ?? {}) }));
};

const ROWS = FEATURES();

function fakeSupabase(rows: Record<string, unknown>[] = ROWS) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: rows, error: null }),
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: rows[0] ?? null,
            error: null,
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { ...rows[0], version: 2, enabled: false },
              error: null,
            }),
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient<Database>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("features registry", () => {
  it("lists every feature ordered by name", async () => {
    const service = fakeSupabase();
    const features = await listFeatures(service);
    expect(features).toHaveLength(2);
    expect(features[0].key).toBe("pdf_analysis");
    expect(features[0].enabled).toBe(true);
    expect(service.from).toHaveBeenCalledWith("features");
  });

  it("available features exclude disabled or hidden entries", async () => {
    const service = fakeSupabase();
    const features = await listAvailableFeatures(service);
    expect(features.map((f) => f.key)).toEqual(["pdf_analysis"]);
  });

  it("getFeatureByKey returns null for a missing key", async () => {
    const service = fakeSupabase([]);
    expect(await getFeatureByKey(service, "missing")).toBeNull();
  });

  it("updateFeature bumps the version and applies the toggle", async () => {
    const service = fakeSupabase();
    const updated = await updateFeature(service, "pdf_analysis", { enabled: false });
    expect(updated.version).toBe(2);
    expect(updated.enabled).toBe(false);
  });

  it("updateFeature rejects an unknown key with NotFound", async () => {
    const service = fakeSupabase([]);
    await expect(updateFeature(service, "nope", { enabled: true })).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});

describe("requireFeature", () => {
  it("allows an enabled, user-visible feature", async () => {
    const service = fakeSupabase();
    await expect(requireFeature(service, "pdf_analysis")).resolves.toBeUndefined();
  });

  it("rejects a disabled feature with ForbiddenError", async () => {
    const service = fakeSupabase([
      { ...ROWS[1], key: "x", enabled: false },
    ]);
    await expect(requireFeature(service, "x")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects an unknown key", async () => {
    const service = fakeSupabase([]);
    await expect(requireFeature(service, "ghost")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects a hidden feature even when enabled", async () => {
    const service = fakeSupabase([
      { ...ROWS[0], available_to_users: false, enabled: true },
    ]);
    await expect(requireFeature(service, "pdf_analysis")).rejects.toBeInstanceOf(
      ForbiddenError
    );
  });

  it("isFeatureEnabled returns false for disabled/unknown features", async () => {
    const service = fakeSupabase([
      { ...ROWS[1], enabled: false },
    ]);
    expect(await isFeatureEnabled(service, "image_generation")).toBe(false);
    expect(await isFeatureEnabled(fakeSupabase([]), "ghost")).toBe(false);
  });
});