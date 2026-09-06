import { ProviderError } from "./errors";
import type { ProviderId } from "./types";

/**
 * Classifies a non-2xx provider HTTP response into a typed ProviderError.
 * Status codes + error codes from the provider's error body drive the
 * classification; the body is truncated for logs and never sent to the client.
 */
export function classifyHttpError(
  provider: ProviderId,
  status: number,
  bodyText: string
): ProviderError {
  const combined = bodyText.slice(0, 2000);

  if (status === 401) {
    return new ProviderError(provider, "AUTH", "Invalid API key or credentials.", false, status);
  }

  if (status === 403) {
    if (/quota|rate.?limit|resource.?exhausted|permission_denied|restricted/i.test(combined)) {
      return new ProviderError(provider, "QUOTA_EXCEEDED", "Provider quota exhausted.", true, status);
    }
    return new ProviderError(provider, "AUTH", "Request forbidden by provider.", false, status);
  }

  if (status === 429) {
    const code = /quota|insufficient_quota/i.test(combined) ? "QUOTA_EXCEEDED" : "RATE_LIMITED";
    return new ProviderError(provider, code, "Provider rate limited.", true, status);
  }

  if (status === 400 || status === 422) {
    if (/content_filter|safety|unsupported_content/i.test(combined)) {
      return new ProviderError(provider, "CONTENT_FILTER", "Content blocked by safety filters.", false, status);
    }
    if (/api.?key not valid|invalid.?api.?key|api_key_invalid/i.test(combined)) {
      // Gemini rejects bad keys with a 400 INVALID_ARGUMENT response.
      return new ProviderError(provider, "AUTH", "Invalid API key or credentials.", false, status);
    }
    return new ProviderError(provider, "BAD_REQUEST", "Provider rejected the request.", false, status);
  }

  if (status >= 500) {
    return new ProviderError(provider, "UPSTREAM", "Provider returned a server error.", true, status);
  }

  return new ProviderError(provider, "BAD_REQUEST", "Unexpected provider response.", false, status);
}

/** Wraps fetch-level failures (network, abort) into typed errors. */
export function classifyFetchError(provider: ProviderId, err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof DOMException && err.name === "AbortError") {
    return new ProviderError(provider, "ABORTED", "Request aborted by the client.", false);
  }
  return new ProviderError(
    provider,
    "NETWORK",
    err instanceof Error ? err.message : "Network failure while contacting provider.",
    true
  );
}

export interface FetchLike {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

const globalFetch: FetchLike = (...args) => fetch(...args);

/** Injectable fetch (tests pass a stub); global fetch in production. */
export function resolveFetch(fetchImpl?: FetchLike): FetchLike {
  return fetchImpl ?? globalFetch;
}