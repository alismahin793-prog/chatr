import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin/security";
import { reviewProposal } from "@/server/admin/improvements";
import { readJsonBody, toApiError } from "@/server/api/helpers";
import { formatZodError, reviewProposalSchema } from "@/server/validation/schemas";
import { ValidationError } from "@/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/admin/improvements/[id]
 * Approves, rejects, or marks an improvement proposal as implemented.
 * Sensitive: requires a fresh 30-second re-auth window.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAdmin();
    const { id } = await params;
    const body = await readJsonBody<unknown>(request);
    const parsed = reviewProposalSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(formatZodError(parsed.error).message);
    }
    const proposal = await reviewProposal(ctx.service, id, parsed.data, ctx.user.id);
    return NextResponse.json({ proposal });
  } catch (err) {
    return toApiError(err);
  }
}