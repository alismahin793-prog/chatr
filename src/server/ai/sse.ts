import { ProviderError } from "./errors";
import type { ProviderId } from "./types";

/**
 * Yields JSON payloads from a `data:` SSE stream (normalized across providers).
 * Malformed lines are skipped; an empty body is an upstream failure.
 */
export async function* iterSseData(
  response: Response,
  provider: ProviderId
): AsyncGenerator<Record<string, unknown>> {
  if (!response.body) {
    throw new ProviderError(provider, "UPSTREAM", "Provider returned an empty stream.", true);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.startsWith("data:")) continue;

        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        try {
          yield JSON.parse(payload) as Record<string, unknown>;
        } catch {
          // Skip malformed events instead of killing the stream.
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Lock may already be released on abort.
    }
  }
}