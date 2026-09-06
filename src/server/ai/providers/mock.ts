import { ProviderError } from "@/server/ai/errors";
import type { ChatProvider, ProviderId, StreamChunk } from "@/server/ai/types";

/**
 * Deterministic development/test provider.
 *
 * IMPORTANT: This is NOT an AI inference service and never calls any external
 * API. It exists so `next dev` and automated tests run without cloud
 * credentials. The provider factory refuses to construct it in production;
 * production always uses OpenAI, Anthropic, or Gemini.
 */
export class MockProvider implements ChatProvider {
  readonly id: ProviderId;
  readonly displayName = "Mock (development)";
  readonly availableModels = ["mock-1"] as const;

  readonly model: string;

  constructor(model = "mock-1") {
    this.id = "mock";
    this.model = model;
  }

  get defaultModel(): string {
    return this.model;
  }

  async *chat(params: Parameters<ChatProvider["chat"]>[0]): AsyncGenerator<StreamChunk> {
    if (process.env.NODE_ENV === "production") {
      throw new ProviderError(
        this.id,
        "CONFIG",
        "The mock provider is disabled in production. Set AI_PROVIDER to a real provider."
      );
    }

    const last = params.messages[params.messages.length - 1];
    const content =
      last && last.content.trim().length > 40
        ? `${last.content.trim().slice(0, 40)}…`
        : last?.content.trim() ?? "(no message)";

    const lines = [
      `Mock reply to: "${content}"`,
      "",
      `I see ${params.messages.length} message(s) in this conversation${
        params.model ? `, using model "${params.model}"` : ""
      }.`,
      "",
      "To use a real provider: add an API key (OPENAI_API_KEY, ANTHROPIC_API_KEY,",
      "or GEMINI_API_KEY), set AI_PROVIDER, and redeploy.",
    ];

    for (const line of lines) {
      // Yield with cooperative scheduling so the stream stays responsive.
      await Promise.resolve();
      yield { delta: `${line}\n` };
    }
  }
}