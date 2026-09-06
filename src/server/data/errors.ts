import { AppError, ValidationError } from "@/server/errors";

/**
 * Maps a Supabase/PostgREST error to an AppError.
 * 22P02 = invalid UUID/text representation, signals a malformed id.
 */
export function supabaseErrorToAppError(
  err: unknown,
  fallbackMessage = "Database error."
): AppError {
  const message = typeof err === "object" && err && "message" in err
    ? String((err as { message: unknown }).message)
    : fallbackMessage;
  const code =
    typeof err === "object" && err && "code" in err ? (err as { code: unknown }).code : undefined;

  if (code === "22P02") {
    return new ValidationError("Malformed identifier in request.");
  }
  return new AppError("internal", message, 500);
}