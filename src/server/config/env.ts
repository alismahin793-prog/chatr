import { PROVIDER_IDS, type ProviderId } from "@/server/ai/types";

export interface AiSettings {
  provider: ProviderId;
  model: string;
}

const DEFAULT_MODELS: Record<Exclude<ProviderId, "mock">, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
  gemini: "gemini-3.6-flash",
};

function resolveProvider(raw: string | undefined): ProviderId {
  const value = raw?.trim().toLowerCase();

  if (!value) {
    // Not configured → real provider in production, deterministic mock in dev/
    // test so `next dev` works with zero external accounts.
    return process.env.NODE_ENV === "production" ? "openai" : "mock";
  }
  if (!PROVIDER_IDS.includes(value as ProviderId)) {
    throw new Error(
      `Unknown AI_PROVIDER "${raw}". Allowed values: ${PROVIDER_IDS.join(", ")}.`
    );
  }
  return value as ProviderId;
}

function resolveModel(provider: ProviderId, raw: string | undefined): string {
  if (raw?.trim()) return raw.trim();
  return provider === "mock" ? "mock-1" : DEFAULT_MODELS[provider];
}

/** Effective AI provider + model selection for new conversations. */
export function getAiSettings(): AiSettings {
  const provider = resolveProvider(process.env.AI_PROVIDER);
  const envName = provider.toUpperCase();

  return {
    provider,
    model: resolveModel(provider, process.env[`${envName}_MODEL`]),
  };
}

/** How many prior messages are included as context on each turn. */
export function maxContextMessages(): number {
  const raw = process.env.MAX_CONTEXT_MESSAGES;
  if (!raw) return 20;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

/** API key for a real provider, if configured. Undefined otherwise. */
export function getProviderApiKey(provider: ProviderId): string | undefined {
  if (provider === "mock") return undefined;
  return process.env[`${provider.toUpperCase()}_API_KEY`]?.trim() || undefined;
}