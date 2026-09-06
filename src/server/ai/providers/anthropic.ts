import { ProviderError } from "@/server/ai/errors";
import { classifyFetchError, classifyHttpError, resolveFetch, type FetchLike } from "@/server/ai/httperrors";
import { iterSseData } from "@/server/ai/sse";
import type { ChatProvider, ProviderId, StreamChunk } from "@/server/ai/types";

interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: FetchLike;
}

interface AnthropicStreamEvent {
  type?: string;
  delta?: { type?: string; text?: string };
  error?: { type?: string; message?: string };
}

/**
 * Anthropic Messages provider (streaming).
 * https://docs.anthropic.com/en/api/messages
 */
export class AnthropicProvider implements ChatProvider {
  readonly id: ProviderId;
  readonly displayName = "Anthropic";
  readonly availableModels = [
    "claude-3-5-haiku-latest",
    "claude-3-5-sonnet-latest",
    "claude-sonnet-4-20250514",
  ] as const;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: AnthropicProviderOptions) {
    this.id = "anthropic";
    this.apiKey = options.apiKey;
    this.model = options.model ?? "claude-3-5-haiku-latest";
    this.fetchImpl = resolveFetch(options.fetchImpl);
  }

  get defaultModel(): string {
    return this.model;
  }

  async *chat(params: Parameters<ChatProvider["chat"]>[0]): AsyncGenerator<StreamChunk> {
    const body = {
      model: params.model ?? this.model,
      max_tokens: 1024,
      messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    };

    let response: Response;
    try {
      response = await this.fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
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
      const evt = event as AnthropicStreamEvent;
      if (evt.error?.message) {
        throw new ProviderError(
          this.id,
          /overloaded/i.test(`${evt.error.type} ${evt.error.message}`) ? "UPSTREAM" : "BAD_REQUEST",
          `Anthropic mid-stream error: ${evt.error.message}`
        );
      }
      if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta" && evt.delta.text) {
        yield { delta: evt.delta.text };
      }
    }
  }
}