export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "reauth_required"
  | "reauth_failed"
  | "not_found"
  | "validation"
  | "conflict"
  | "rate_limited"
  | "unavailable"
  | "internal";

/** Application error carrying an HTTP-friendly status code. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found.") {
    super("not_found", message, 404);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super("validation", message, 400);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required.") {
    super("unauthorized", message, 401);
  }
}

/** The caller is signed in but does not hold the required role. */
export class ForbiddenError extends AppError {
  constructor(message = "Access denied.") {
    super("forbidden", message, 403);
  }
}

/**
 * The caller is an admin but their privileges have expired and they must
 * re-authenticate before the privileges are restored.
 */
export class AdminReauthRequiredError extends AppError {
  constructor(message = "Admin re-authentication is required.") {
    super("reauth_required", message, 401);
  }
}

/** The password check behind admin re-authentication did not match. */
export class ReauthFailedError extends AppError {
  constructor(message = "Re-authentication failed. Try again.") {
    super("reauth_failed", message, 401);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}