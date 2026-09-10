import { NextResponse } from "next/server";
import { requireAdminIdentity } from "@/server/admin/security";
import { createProposal, listProposals } from "@/server/admin/improvements";
import { readJsonBody, toApiError } from "@/server/api/helpers";
import {
  createProposalSchema,
  formatZodError,
} from "@/server/validation/schemas";
import { ValidationError } from "@/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/improvements
 * Lists improvement proposals. Any admin may read them.
 */
export async function GET() {
  try {
    const ctx = await requireAdminIdentity();
    const proposals = await listProposals(ctx.service);
    return NextResponse.json({ proposals });
  } catch (err) {
    return toApiError(err);
  }
}

/**
 * POST /api/admin/improvements
 * Submits a new improvement proposal. Requires super_admin identity. This
 * only records the proposal — it never executes code or touches the app.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireAdminIdentity();
    const body = await readJsonBody<unknown>(request);
    const parsed = createProposalSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(formatZodError(parsed.error).message);
    }
    const proposal = await createProposal(ctx.service, parsed.data, ctx.user.id);
    return NextResponse.json({ proposal }, { status: 201 });
  } catch (err) {
    return toApiError(err);
  }
}