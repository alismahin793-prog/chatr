import { NextResponse } from "next/server";
import { requireUser } from "@/server/api/helpers";
import { toApiError } from "@/server/api/helpers";
import { createServiceClient } from "@/lib/supabase/service";
import { listAvailableFeatures } from "@/server/features/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/features
 * User-facing feature discovery: returns the registry entries currently
 * enabled AND visible to regular users. Any authenticated user may read it.
 * The registry itself is service-role only, so callers see nothing blocked.
 */
export async function GET() {
  try {
    await requireUser();
    const features = await listAvailableFeatures(createServiceClient());
    return NextResponse.json({ features });
  } catch (err) {
    return toApiError(err);
  }
}