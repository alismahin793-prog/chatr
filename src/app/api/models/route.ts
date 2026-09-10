import { NextResponse } from "next/server";
import { listAvailableProviders } from "@/server/ai/factory";
import { CAPABILITIES, requireCapability } from "@/server/auth/capabilities";
import { requireUser, toApiError } from "@/server/api/helpers";

export const runtime = "nodejs";

export async function GET() {
  try {
    // Requires an authenticated session. Test users additionally need the
    // "models" capability; the list itself exposes only provider
    // descriptors, never secrets.
    const { supabase, user } = await requireUser();
    await requireCapability(supabase, user.id, CAPABILITIES.MODELS);
    return NextResponse.json({ providers: listAvailableProviders() });
  } catch (err) {
    return toApiError(err);
  }
}