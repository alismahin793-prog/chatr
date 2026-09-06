import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { type ErrorCode, UnauthorizedError, ValidationError, isAppError } from "@/server/errors";
import { ProviderError, type ProviderErrorCode } from "@/server/ai/errors";

export interface RequestContext {
  supabase: SupabaseClient<Database>;
  user: User;
}

/**
 * Authenticates the current request using the cookie session and returns a
 * user-scoped Supabase client. Every protected route handler starts here;
 * authorization is NOT delegated to the proxy alone.
 */
export async function requireUser(): Promise<RequestContext> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) throw new UnauthorizedError();
  return { supabase, user };
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

/** Safe user-facing message for a provider failure (never leaks secrets). */
export function providerErrorMessage(code: ProviderErrorCode): string {
  switch (code) {
    case "CONFIG":
      return "AI provider is not configured.";
    case "AUTH":
      return "AI provider rejected the configured API key.";
    case "RATE_LIMITED":
    case "QUOTA_EXCEEDED":
      return "AI provider limit reached. Try again shortly.";
    case "CONTENT_FILTER":
      return "The request was blocked by the AI provider's safety filters.";
    case "BAD_REQUEST":
      return "The AI provider rejected the request.";
    case "UPSTREAM":
    case "NETWORK":
      return "The AI provider is temporarily unavailable. Try again shortly.";
    case "ABORTED":
      return "Request aborted.";
  }
}

function providerStatus(error: ProviderError): { status: number; message: string } {
  const statusByCode: Partial<Record<ProviderErrorCode, number>> = {
    CONFIG: 500,
    AUTH: 502,
    BAD_REQUEST: 502,
    CONTENT_FILTER: 400,
    UPSTREAM: 503,
    NETWORK: 503,
    ABORTED: 499,
  };
  const status = statusByCode[error.code] ?? 429;
  return { status, message: providerErrorMessage(error.code) };
}

/** Maps any thrown error to a safe client-facing JSON error response. */
export function toApiError(err: unknown): NextResponse<ApiErrorBody> {
  if (isAppError(err)) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status }
    );
  }
  if (err instanceof ProviderError) {
    const { status, message } = providerStatus(err);
    const code = err.code.toLowerCase() as ErrorCode;
    return NextResponse.json({ error: { code, message } }, { status });
  }
  // Unknown error: keep server stack traces out of client responses.
  console.error(err);
  return NextResponse.json(
    { error: { code: "internal", message: "An unexpected error occurred." } },
    { status: 500 }
  );
}

/** Reads and parses a JSON request body, throwing a readable error on bad input. */
export async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ValidationError("Request body is not valid JSON.");
  }
}