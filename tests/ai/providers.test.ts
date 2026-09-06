import { describe, expect, it, vi, afterEach } from "vitest";
import type { FetchLike } from "@/server/ai/httperrors";
import { ProviderError } from "@/server/ai/errors";
import { OpenAIProvider } from "@/server/ai/providers/openai";
import { AnthropicProvider } from "@/server/ai/providers/anthropic";
import { GeminiProvider } from "@/server/ai/providers/gemini";
import { MockProvider } from "@/server/ai/providers/mock";
import type { ChatMessage } from "@/server/ai/types";

const MESSAGES: ChatMessage[] = [
  { role: "user", content: "Hello" },
  { role: "assistant", content: "Hi there" },
  { role: "user", content: "Tell me a joke" },
];

function streamResponse(events: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const evt of events) {
        controller.enqueue(new TextEncoder().encode(`${evt}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function jsonReponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(handler: (url: string, init: RequestInit) => Response): FetchLike {
  return async (url, init) => handler(String(url), init as RequestInit);
}

async function collect(gen: AsyncGenerator<{ delta: string }>): Promise<string> {
  let out = "";
  for await (const chunk of gen) out += chunk.delta;
  return out;
}

function clearAiEnv() {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_PROVIDER;
}

function setNodeEnv(value: string) {
  (process.env as { NODE_ENV?: string }).NODE_ENV = value;
}

afterEach(() => {
  vi.restoreAllMocks();
  clearAiEnv();
});

describe("MockProvider", () => {
  it("yields a deterministic reply without any network call", async () => {
    const provider = new MockProvider();
    const text = await collect(provider.chat({ messages: MESSAGES }));
    expect(text).toContain('Mock reply to: "Tell me a joke"');
  });

  it("throws CONFIG in production", async () => {
    const original = process.env.NODE_ENV;
    setNodeEnv("production");
    try {
      await expect(
        collect(new MockProvider().chat({ messages: MESSAGES }))
      ).rejects.toMatchObject({ code: "CONFIG" });
    } finally {
      setNodeEnv(original ?? "test");
    }
  });
});

describe("OpenAIProvider", () => {
  it("streams text deltas from SSE chunks", async () => {
    const fetchImpl = stubFetch(() =>
      streamResponse([
        'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        "data: [DONE]",
      ])
    );
    const text = await collect(new OpenAIProvider({ apiKey: "sk-test", fetchImpl }).chat({ messages: MESSAGES }));
    expect(text).toBe("Hello world");
  });

  it("sends the right payload and auth header", async () => {
    let capturedInit: RequestInit | undefined;
    let capturedUrl = "";
    const fetchImpl = stubFetch((url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return streamResponse(["data: [DONE]"]);
    });

    await collect(new OpenAIProvider({ apiKey: "sk-secret", fetchImpl }).chat({ messages: MESSAGES }));
    expect(capturedUrl).toBe("https://api.openai.com/v1/chat/completions");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers).toMatchObject({
      Authorization: "Bearer sk-secret",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(capturedInit?.body));
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.stream).toBe(true);
    expect(body.messages).toHaveLength(3);
  });

  it("honours a per-request model override", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = stubFetch((_url, init) => {
      capturedInit = init;
      return streamResponse(["data: [DONE]"]);
    });
    await collect(
      new OpenAIProvider({ apiKey: "k", fetchImpl }).chat({ messages: MESSAGES, model: "gpt-4o" })
    );
    expect(JSON.parse(String(capturedInit?.body)).model).toBe("gpt-4o");
  });

  it("maps 401 to AUTH", async () => {
    const fetchImpl = stubFetch(() =>
      jsonReponse(401, '{"error":{"message":"Incorrect API key","type":"invalid_request_error"}}')
    );
    await expect(collect(openaiWith(fetchImpl).chat({ messages: MESSAGES }))).rejects.toMatchObject({
      code: "AUTH",
      provider: "openai",
      retryable: false,
    });
  });

  it("maps 429 to RATE_LIMITED and quota text to QUOTA_EXCEEDED", async () => {
    const rateLimit = stubFetch(() =>
      jsonReponse(429, '{"error":{"message":"Rate limit reached","type":"rate_limit_error"}}')
    );
    await expect(collect(openaiWith(rateLimit).chat({ messages: MESSAGES }))).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    });

    const quota = stubFetch(() =>
      jsonReponse(429, '{"error":{"message":"You exceeded your current quota","code":"insufficient_quota"}}')
    );
    await expect(collect(openaiWith(quota).chat({ messages: MESSAGES }))).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
    });
  });

  it("maps content_filter 400 to CONTENT_FILTER", async () => {
    const fetchImpl = stubFetch(() =>
      jsonReponse(400, '{"error":{"message":"The response was filtered","code":"content_filter"}}')
    );
    await expect(collect(openaiWith(fetchImpl).chat({ messages: MESSAGES }))).rejects.toMatchObject({
      code: "CONTENT_FILTER",
    });
  });

  it("maps 5xx to retryable UPSTREAM", async () => {
    const fetchImpl = stubFetch(() => jsonReponse(500, "boom"));
    await expect(collect(openaiWith(fetchImpl).chat({ messages: MESSAGES }))).rejects.toMatchObject({
      code: "UPSTREAM",
      retryable: true,
    });
  });

  it("maps abort to ABORTED", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    });
    await expect(collect(openaiWith(fetchImpl).chat({ messages: MESSAGES }))).rejects.toMatchObject({
      code: "ABORTED",
      provider: "openai",
    });
  });

  it("maps network failure to NETWORK", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(collect(openaiWith(fetchImpl).chat({ messages: MESSAGES }))).rejects.toMatchObject({
      code: "NETWORK",
      retryable: true,
    });
  });

  it("surfaces mid-stream errors", async () => {
    const fetchImpl = stubFetch(() =>
      streamResponse(['data: {"error":{"message":"server hiccup"},"choices":[]}'])
    );
    await expect(collect(openaiWith(fetchImpl).chat({ messages: MESSAGES }))).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  function openaiWith(fetchImpl: FetchLike) {
    return new OpenAIProvider({ apiKey: "k", fetchImpl });
  }
});

describe("AnthropicProvider", () => {
  it("streams text_delta content", async () => {
    const fetchImpl = stubFetch(() =>
      streamResponse([
        `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Knock knock"}}`,
        `data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}`,
      ])
    );
    const text = await collect(
      new AnthropicProvider({ apiKey: "k", fetchImpl }).chat({ messages: MESSAGES })
    );
    expect(text).toBe("Knock knock");
  });

  it("sends anthropic headers and version", async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = stubFetch((_url, init) => {
      captured = init;
      return streamResponse(["data: {}"]);
    });
    await collect(new AnthropicProvider({ apiKey: "ak", fetchImpl }).chat({ messages: MESSAGES }));
    expect(captured?.headers).toMatchObject({
      "x-api-key": "ak",
      "anthropic-version": "2023-06-01",
    });
  });

  it("maps 529 overloaded to retryable UPSTREAM", async () => {
    const fetchImpl = stubFetch(() =>
      jsonReponse(529, '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}')
    );
    await expect(
      collect(new AnthropicProvider({ apiKey: "k", fetchImpl }).chat({ messages: MESSAGES }))
    ).rejects.toMatchObject({ code: "UPSTREAM", retryable: true });
  });

  it("maps 401 to AUTH", async () => {
    const fetchImpl = stubFetch(() =>
      jsonReponse(401, '{"type":"error","error":{"type":"authentication_error","message":"bad key"}}')
    );
    await expect(
      collect(new AnthropicProvider({ apiKey: "k", fetchImpl }).chat({ messages: MESSAGES }))
    ).rejects.toMatchObject({ code: "AUTH" });
  });
});

describe("GeminiProvider", () => {
  it("streams candidate text and maps assistant role to model", async () => {
    let capturedBody: unknown;
    const fetchImpl = stubFetch((url, init) => {
      capturedBody = JSON.parse(String(init.body));
      expect(url).toContain("/v1beta/models/gemini-2.5-flash:streamGenerateContent");
      return streamResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Once"}]},"finishReason":"STOP"}]}',
        'data: {"candidates":[{"content":{"parts":[{"text":" upon a time"}]},"finishReason":"STOP"}]}',
      ]);
    });
    const text = await collect(
      new GeminiProvider({ apiKey: "gk", fetchImpl }).chat({ messages: MESSAGES })
    );
    expect(text).toBe("Once upon a time");
    const contents = (capturedBody as { contents: Array<{ role: string }> }).contents;
    expect(contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
  });

  it("maps 403 quota to QUOTA_EXCEEDED", async () => {
    const fetchImpl = stubFetch(() =>
      jsonReponse(
        403,
        '{"error":{"code":429,"message":"Quota exceeded","status":"RESOURCE_EXHAUSTED"}}'
      )
    );
    await expect(
      collect(new GeminiProvider({ apiKey: "k", fetchImpl }).chat({ messages: MESSAGES }))
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED", retryable: true });
  });

  it("maps 429 to RATE_LIMITED", async () => {
    const fetchImpl = stubFetch(() =>
      jsonReponse(429, '{"error":{"code":429,"message":"rateLimitExceeded","status":"RESOURCE_EXHAUSTED"}}')
    );
    await expect(
      collect(new GeminiProvider({ apiKey: "k", fetchImpl }).chat({ messages: MESSAGES }))
    ).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
  });

  it("maps a 400 invalid key to AUTH", async () => {
    const fetchImpl = stubFetch(() =>
      jsonReponse(
        400,
        '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}'
      )
    );
    await expect(
      collect(new GeminiProvider({ apiKey: "badkey", fetchImpl }).chat({ messages: MESSAGES }))
    ).rejects.toMatchObject({ code: "AUTH", provider: "gemini", retryable: false });
  });

  it("maps a mid-stream quota error to QUOTA_EXCEEDED", async () => {
    const fetchImpl = stubFetch(() =>
      streamResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Partial"}]},"finishReason":null}]}',
        'data: {"error":{"code":429,"message":"Requests to the Gemini API have exceeded the hourly request quota.","status":"RESOURCE_EXHAUSTED"}}',
      ])
    );
    await expect(
      collect(new GeminiProvider({ apiKey: "k", fetchImpl }).chat({ messages: MESSAGES }))
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
  });

  it("defaults to gemini-2.5-flash without an override", async () => {
    let capturedUrl = "";
    const fetchImpl = stubFetch((url) => {
      capturedUrl = String(url);
      return streamResponse([]);
    });
    await collect(new GeminiProvider({ apiKey: "k", fetchImpl }).chat({ messages: MESSAGES }));
    expect(capturedUrl).toContain("/v1beta/models/gemini-2.5-flash:streamGenerateContent");
  });
});

describe("provider error shape", () => {
  it("ProviderError carries provider, code and retryable", () => {
    const err = new ProviderError("openai", "RATE_LIMITED", "x", true, 429);
    expect(err.provider).toBe("openai");
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.retryable).toBe(true);
    expect(err.statusCode).toBe(429);
  });
});