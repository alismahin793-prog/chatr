import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  createProposal,
  listProposals,
  reviewProposal,
} from "@/server/admin/improvements";
import { NotFoundError, ValidationError } from "@/server/errors";

vi.mock("@/server/admin/audit", () => ({ logAdminAction: vi.fn() }));
import { logAdminAction } from "@/server/admin/audit";

const PROPOSAL = {
  id: "33333333-3333-4333-8333-333333333333",
  title: "Add dark mode",
  description: "Users want a dark theme.",
  status: "proposed",
  proposed_by: "11111111-1111-4111-8111-111111111111",
  reviewed_by: null,
  review_comment: null,
  created_at: "2026-01-01T00:00:00.000Z",
  reviewed_at: null,
};

function fakeSupabase() {
  const maybeSingle = vi.fn().mockResolvedValue({ data: PROPOSAL, error: null });
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: [PROPOSAL], error: null }),
        eq: vi.fn().mockReturnValue({ maybeSingle }),
      }),
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: PROPOSAL, error: null }) }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { ...PROPOSAL, status: "approved" },
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
  vi.mocked(logAdminAction).mockResolvedValue(true);
});

describe("improvement proposals", () => {
  it("lists proposals newest first, optionally filtered by status", async () => {
    const service = fakeSupabase();
    const all = await listProposals(service);
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe("Add dark mode");
    expect(service.from).toHaveBeenCalledWith("improvement_proposals");
  });

  it("creates a proposal and logs it to the audit trail", async () => {
    const service = fakeSupabase();
    const created = await createProposal(
      service,
      { title: "Add dark mode", description: "Users want a dark theme." },
      "11111111-1111-4111-8111-111111111111"
    );
    expect(created.status).toBe("proposed");
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "improvements.proposal_created" })
    );
  });

  it("reviews a proposal as approved with a comment and audit entry", async () => {
    const service = fakeSupabase();
    const reviewed = await reviewProposal(
      service,
      PROPOSAL.id,
      { status: "approved", comment: "Looks good" },
      "11111111-1111-4111-8111-111111111111"
    );
    expect(reviewed.status).toBe("approved");
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "improvements.proposal_approved" })
    );
  });

  it("rejects a review for an invalid target status", async () => {
    const service = fakeSupabase();
    await expect(
      reviewProposal(
        service,
        PROPOSAL.id,
        { status: "proposed" as never },
        "11111111-1111-4111-8111-111111111111"
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a review for a missing proposal", async () => {
    const empty = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;
    await expect(
      reviewProposal(
        empty,
        PROPOSAL.id,
        { status: "approved" },
        "11111111-1111-4111-8111-111111111111"
      )
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});