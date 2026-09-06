import { describe, expect, it, afterEach } from "vitest";
import { createProvider, fallbackProviderIds, listAvailableProviders } from "@/server/ai/factory";
import { ProviderError } from "@/server/ai/errors";
import { OpenAIProvider } from "@/server/ai/providers/openai";
import { AnthropicProvider } from "@/server/ai/providers/anthropic";
import { GeminiProvider } from "@/server/ai/providers/gemini";
import { MockProvider } from "@/server/ai/providers/mock";

const KEY_VARS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"] as const;

function clearKeys() {
  for (const v of KEY_VARS) delete process.env[v];
  delete process.env.AI_PROVIDER;
  delete process.env.OPENAI_MODEL;
}

function setNodeEnv(value: string) {
  (process.env as { NODE_ENV?: string }).NODE_ENV = value;
}

afterEach(clearKeys);

describe("createProvider", () => {
  it("throws CONFIG when a real provider has no API key", () => {
    expect(() => createProvider("openai")).toThrowError(
      expect.objectContaining({ code: "CONFIG", provider: "openai" })
    );
    expect(() => createProvider("anthropic")).toThrow(ProviderError);
    expect(() => createProvider("gemini")).toThrow(ProviderError);
  });

  it("builds the right adapter when a key is present", () => {
    process.env.OPENAI_API_KEY = "k1";
    process.env.ANTHROPIC_API_KEY = "k2";
    process.env.GEMINI_API_KEY = "k3";

    expect(createProvider("openai")).toBeInstanceOf(OpenAIProvider);
    expect(createProvider("anthropic")).toBeInstanceOf(AnthropicProvider);
    expect(createProvider("gemini")).toBeInstanceOf(GeminiProvider);
  });

  it("allows test injection via options", () => {
    expect(createProvider("openai", { apiKey: "injected" })).toBeInstanceOf(OpenAIProvider);
  });

  it("defaults to the mock provider in dev when AI_PROVIDER is unset", () => {
    const previous = process.env.NODE_ENV;
    setNodeEnv("development");
    try {
      expect(createProvider("mock")).toBeInstanceOf(MockProvider);
    } finally {
      setNodeEnv(previous ?? "test");
    }
  });

  it("throws in production when requesting the mock provider", () => {
    const previous = process.env.NODE_ENV;
    setNodeEnv("production");
    try {
      expect(() => createProvider("mock")).toThrowError(
        expect.objectContaining({ code: "CONFIG" })
      );
    } finally {
      setNodeEnv(previous ?? "test");
    }
  });
});

describe("listAvailableProviders", () => {
  it("lists only configured real providers plus mock in development", () => {
    const previous = process.env.NODE_ENV;
    setNodeEnv("development");
    process.env.OPENAI_API_KEY = "k";
    try {
      const list = listAvailableProviders();
      const ids = list.map((d) => d.id);
      expect(ids).toContain("openai");
      expect(ids).toContain("mock");
      expect(ids).not.toContain("anthropic");
      expect(ids).not.toContain("gemini");
      expect(list.find((d) => d.id === "openai")).toMatchObject({
        displayName: "OpenAI",
      });
    } finally {
      setNodeEnv(previous ?? "test");
    }
  });

  it("never exposes the mock provider in production and requires keys", () => {
    const previous = process.env.NODE_ENV;
    setNodeEnv("production");
    try {
      const ids = listAvailableProviders().map((d) => d.id);
      expect(ids).not.toContain("mock");
      expect(ids).toEqual([]);
    } finally {
      setNodeEnv(previous ?? "test");
    }
  });
});

describe("fallbackProviderIds", () => {
  it("returns configured real providers except the excluded one", () => {
    process.env.OPENAI_API_KEY = "k1";
    process.env.GEMINI_API_KEY = "k3";

    expect(fallbackProviderIds("openai")).toEqual(["gemini"]);
    expect(fallbackProviderIds("gemini")).toEqual(["openai"]);
    expect(fallbackProviderIds("anthropic")).toEqual(["openai", "gemini"]);
  });

  it("never includes mock or providers without a key", () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;

    expect(fallbackProviderIds("mock")).toEqual([]);
    expect(fallbackProviderIds("openai")).toEqual([]);
  });
});