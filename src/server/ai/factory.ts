import { getProviderApiKey } from "@/server/config/env";
import { ProviderError } from "./errors";
import type { FetchLike } from "./httperrors";
import { AnthropicProvider } from "./providers/anthropic";
import { GeminiProvider } from "./providers/gemini";
import { MockProvider } from "./providers/mock";
import { OpenAIProvider } from "./providers/openai";
import {
  PROVIDER_IDS,
  type ChatProvider,
  type ProviderDescriptor,
  type ProviderId,
} from "./types";

export interface ProviderFactoryOptions {
  /** Override API key lookup (used by tests). */
  apiKey?: string;
  /** Override the model configured via env. */
  model?: string;
  /** Injectable fetch for tests. */
  fetchImpl?: FetchLike;
}

const DESCRIPTORS: Record<ProviderId, Omit<ProviderDescriptor, "id">> = {
  openai: { displayName: "OpenAI", defaultModel: "gpt-4o-mini", availableModels: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"] },
  anthropic: { displayName: "Anthropic", defaultModel: "claude-3-5-haiku-latest", availableModels: ["claude-3-5-haiku-latest", "claude-3-5-sonnet-latest"] },
  gemini: { displayName: "Google Gemini", defaultModel: "gemini-2.5-flash", availableModels: ["gemini-2.5-flash"] },
  mock: { displayName: "Mock (development)", defaultModel: "mock-1", availableModels: ["mock-1"] },
};

function isRealProvider(id: ProviderId): id is Exclude<ProviderId, "mock"> {
  return id !== "mock";
}

/**
 * Real providers with a configured API key, in UI order, excluding `exclude`.
 * Used to build the automatic fallback chain when the selected provider hits
 * its usage quota.
 */
export function fallbackProviderIds(exclude: ProviderId): Exclude<ProviderId, "mock">[] {
  return PROVIDER_IDS.filter(
    (id): id is Exclude<ProviderId, "mock"> =>
      isRealProvider(id) && id !== exclude && Boolean(getProviderApiKey(id))
  );
}

/**
 * Builds a ChatProvider. Real providers require an API key from the
 * environment (or the injected override). `mock` is dev/test only and throws
 * in production rather than silently serving fake replies.
 */
export function createProvider(
  provider: ProviderId,
  options: ProviderFactoryOptions = {}
): ChatProvider {
  if (provider === "mock") {
    if (process.env.NODE_ENV === "production") {
      throw new ProviderError(provider, "CONFIG", "Mock provider is disabled in production.");
    }
    return new MockProvider();
  }

  const apiKey = options.apiKey ?? getProviderApiKey(provider);
  if (!apiKey) {
    throw new ProviderError(
      provider,
      "CONFIG",
      `No API key configured for "${provider}". Set ${provider.toUpperCase()}_API_KEY in your environment.`
    );
  }

  switch (provider) {
    case "openai":
      return new OpenAIProvider({ apiKey, model: options.model, fetchImpl: options.fetchImpl });
    case "anthropic":
      return new AnthropicProvider({ apiKey, model: options.model, fetchImpl: options.fetchImpl });
    case "gemini":
      return new GeminiProvider({ apiKey, model: options.model, fetchImpl: options.fetchImpl });
  }
}

/**
 * Providers the UI can offer: real ones with a configured key, plus the mock
 * provider during development. Never exposes keys — only descriptors.
 */
export function listAvailableProviders(): ProviderDescriptor[] {
  const result: ProviderDescriptor[] = [];

  for (const id of PROVIDER_IDS) {
    if (isRealProvider(id)) {
      if (!getProviderApiKey(id)) continue;
      result.push({ id, ...DESCRIPTORS[id] });
    } else {
      if (process.env.NODE_ENV === "production") continue;
      result.push({ id, ...DESCRIPTORS[id] });
    }
  }

  return result;
}