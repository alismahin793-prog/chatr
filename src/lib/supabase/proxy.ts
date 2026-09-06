import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "./env";

const OPEN_PATHS = [/^\/login/, /^\/signup/, /^\/auth\//, /^\/api\//];

/**
 * Runs inside `proxy.ts` on every request: refreshes the Supabase auth cookie
 * session and enforces page-level route protection. API routes are intentionally
 * left alone — each handler re-verifies the user server-side via getUser().
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
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname === "/" || pathname === "/login" || pathname === "/signup") {
    return NextResponse.redirect(new URL("/chat", request.url));
  }

  return supabaseResponse;
}