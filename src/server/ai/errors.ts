import type { ProviderId } from "./types";

export type ProviderErrorCode =
  | "CONFIG"
  | "AUTH"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "BAD_REQUEST"
  | "CONTENT_FILTER"
  | "UPSTREAM"
  | "NETWORK"
  | "ABORTED";

/**
 * A failure from the AI inference layer. The `code` drives both HTTP mapping
 * (in API handlers) and user-facing messaging; details are never logged with
 * secrets.
 */
export class ProviderError extends Error {
  constructor(
    public readonly provider: ProviderId,
    public readonly code: ProviderErrorCode,
    message: string,
    /** True when a retry after a short wait could succeed. */
    public readonly retryable = false,
    public readonly statusCode?: number,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "ProviderError";
  }
}

export function isProviderError(err: unknown): err is ProviderError {
  return err instanceof ProviderError;
}