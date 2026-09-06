import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { clearAdminVerified } from "@/server/admin/security";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.auth.signOut();

  if (user) {
    // Revoke admin elevation when the admin leaves the system. Best-effort:
    // the 30-second re-authentication window expires naturally anyway, and we
    // must not let a sign-out fail over a background cleanup task.
    try {
      await clearAdminVerified(createServiceClient(), user.id);
    } catch {
      // Elevation is capped by the re-authentication window regardless.
    }
  }

  const origin = new URL(request.url).origin;
  return NextResponse.redirect(`${origin}/login`, { status: 303 });
}