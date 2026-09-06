export const PROVIDER_IDS = ["openai", "anthropic", "gemini", "mock"] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** A normalized chunk of streamed assistant output. */
export interface StreamChunk {
  delta: string;
}

export interface ChatCompletionParams {
  /** Full message history including the latest user turn. */
  messages: ChatMessage[];
  /** Model override (defaults to the provider's configured model). */
  model?: string;
  /** Abort support for client disconnects. */
  signal?: AbortSignal;
}

/**
 * A cloud AI inference backend.
 *
 * Implementations translate between the normalized ChatMessage format and the
 * provider's HTTP API, stream deltas back through `chat()`, and surface
 * failures as `ProviderError`.
 */
export interface ChatProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly defaultModel: string;
  readonly availableModels: readonly string[];

  chat(params: ChatCompletionParams): AsyncGenerator<StreamChunk>;
}

export interface ProviderDescriptor {
  id: ProviderId;
  displayName: string;
  defaultModel: string;
  availableModels: string[];
}