import { NextResponse } from "next/server";
import { requireAdminIdentity } from "@/server/admin/security";
import { searchAccounts } from "@/server/admin/accounts";
import { readJsonBody, toApiError } from "@/server/api/helpers";
import { accountSearchSchema, formatZodError } from "@/server/validation/schemas";
import { ValidationError } from "@/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/accounts
 * Searches the account directory by email or display name. Requires
 * super_admin identity (read-only admin action).
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireAdminIdentity();
    const body = await readJsonBody<unknown>(request);
    const parsed = accountSearchSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(formatZodError(parsed.error).message);
    }
    const accounts = await searchAccounts(ctx.service, parsed.data.query);
    return NextResponse.json({ accounts });
  } catch (err) {
    return toApiError(err);
  }
}