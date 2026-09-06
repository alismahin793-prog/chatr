export type ErrorCode =
  | "unauthorized"
  | "forbidden"
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

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}