import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "./env";

const OPEN_PATHS = [/^\/login/, /^\/signup/, /^\/auth\//, /^\/api\//];

const SUPER_ADMIN_ROLE = "super_admin";

/** Mirrors import { isApprovedStatus } from capabilities without edge deps. */
function isApprovedStatus(status: string | null | undefined): boolean {
  return status === "active" || status === "approved";
}

/**
 * Runs inside `proxy.ts` on every request: refreshes the Supabase auth cookie
 * session and enforces page-level route protection. API routes are intentionally
 * left alone — each handler re-verifies the user server-side via getUser().
 *
 * Signed-in accounts whose profile status is pending/rejected/disabled are
 * sent to /pending (the super_admin owner is never blocked). Pages are also
 * protected server-side in each route; this is the UX-level gate.
 *
 * This mirrors the Supabase SSR `updateSession` guidance for Next.js; the file
 * convention is named `proxy` (the Next.js 16 successor to `middleware`).
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const { url, anonKey } = supabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // IMPORTANT: no code between createServerClient and getUser()
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user) {
    if (OPEN_PATHS.some((p) => p.test(pathname))) {
      return supabaseResponse;
    }
    // Preserve the destination so the login form can bounce the user back
    // after a successful sign-in (e.g. /admin -> /login?next=/admin).
    const login = new URL("/login", request.url);
    if (pathname !== "/") {
      login.searchParams.set("next", pathname + request.nextUrl.search);
    }
    return NextResponse.redirect(login);
  }

  // Registration-approval gate: pending/rejected/disabled accounts cannot
  // reach app pages. /pending itself is allowed through so the page can
  // resolve which status it is showing. Fail-open on a read error — every
  // API route still enforces the lifecycle itself.
  if (!OPEN_PATHS.some((p) => p.test(pathname)) && pathname !== "/pending") {
    try {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("role, status")
        .eq("id", user.id)
        .maybeSingle();
      const blocked =
        !error &&
        profile !== null &&
        profile.role !== SUPER_ADMIN_ROLE &&
        !isApprovedStatus(profile.status);
      if (blocked) {
        return NextResponse.redirect(new URL("/pending", request.url));
      }
    } catch {
      // Fail open here; the guarded routes reject blocked accounts anyway.
    }
  }

  if (pathname === "/" || pathname === "/login" || pathname === "/signup") {
    const next = request.nextUrl.searchParams.get("next");
    if (next && next.startsWith("/") && !next.startsWith("//")) {
      return NextResponse.redirect(new URL(next, request.url));
    }
    return NextResponse.redirect(new URL("/chat", request.url));
  }

  return supabaseResponse;
}