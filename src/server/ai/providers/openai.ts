import { ProviderError } from "@/server/ai/errors";
import { classifyFetchError, classifyHttpError, resolveFetch, type FetchLike } from "@/server/ai/httperrors";
import { iterSseData } from "@/server/ai/sse";
import type { ChatProvider, ProviderId, StreamChunk } from "@/server/ai/types";

interface OpenAIProviderOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: FetchLike;
}

interface OpenAIChatCompletionChunk {
  choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
  error?: { message?: string; code?: string; type?: string };
}

/**
 * OpenAI Chat Completions provider (streaming).
 * https://platform.openai.com/docs/api-reference/chat
 */
export class OpenAIProvider implements ChatProvider {
  readonly id: ProviderId;
  readonly displayName = "OpenAI";
  readonly availableModels = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"] as const;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: OpenAIProviderOptions) {
    this.id = "openai";
    this.apiKey = options.apiKey;
    this.model = options.model ?? "gpt-4o-mini";
    this.fetchImpl = resolveFetch(options.fetchImpl);
  }

  get defaultModel(): string {
    return this.model;
  }

  async *chat(params: Parameters<ChatProvider["chat"]>[0]): AsyncGenerator<StreamChunk> {
    const model = params.model ?? this.model;
    const body = {
      model,
      messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    };

    let response: Response;
    try {
      response = await this.fetchImpl("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
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
      const chunk = event as OpenAIChatCompletionChunk;
      if (chunk.error?.message) {
        throw new ProviderError(
          this.id,
          chunk.error.code === "content_filter" ? "CONTENT_FILTER" : "BAD_REQUEST",
          `OpenAI mid-stream error: ${chunk.error.message}`
        );
      }
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        yield { delta };
      }
    }
  }
}