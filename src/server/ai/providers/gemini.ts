import { ProviderError } from "@/server/ai/errors";
import { classifyFetchError, classifyHttpError, resolveFetch, type FetchLike } from "@/server/ai/httperrors";
import { iterSseData } from "@/server/ai/sse";
import type { ChatProvider, ProviderId, StreamChunk } from "@/server/ai/types";

interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: FetchLike;
}

interface GeminiStreamEvent {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  error?: { code?: number; message?: string; status?: string };
}

/**
 * Google Gemini provider (streaming via SSE).
 * https://ai.google.dev/api/generate-content
 */
export class GeminiProvider implements ChatProvider {
  readonly id: ProviderId;
  readonly displayName = "Google Gemini";
  readonly availableModels = ["gemini-2.5-flash"] as const;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: GeminiProviderOptions) {
    this.id = "gemini";
    this.apiKey = options.apiKey;
    this.model = options.model ?? "gemini-2.5-flash";
    this.fetchImpl = resolveFetch(options.fetchImpl);
  }

  get defaultModel(): string {
    return this.model;
  }

  async *chat(params: Parameters<ChatProvider["chat"]>[0]): AsyncGenerator<StreamChunk> {
    // Gemini uses "model" as the assistant role.
    const contents = params.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const model = params.model ?? this.model;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents }),
        signal: params.signal,
      });
    } catch (err) {
      throw classifyFetchError(this.id, err);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw classifyHttpError(this.id, response.status, text);
    }

    for await (const event of iterSseData(response, this.id)) {
      const evt = event as GeminiStreamEvent;
      if (evt.error?.message) {
        const isResourceExhausted =
          evt.error.status === "RESOURCE_EXHAUSTED" && evt.error.code === 429;
        throw new ProviderError(
          this.id,
          isResourceExhausted
            ? /quota|exceeded/i.test(evt.error.message)
              ? "QUOTA_EXCEEDED"
              : "RATE_LIMITED"
            : "BAD_REQUEST",
          `Gemini mid-stream error: ${evt.error.message}`
        );
      }
      const text = evt.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
      if (text) {
        yield { delta: text };
      }
    }
  }
}