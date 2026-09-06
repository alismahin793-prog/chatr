import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/chat/route";
import { createClient } from "@/lib/supabase/server";
import {
  createConversation,
  getConversation,
  updateConversationProvider,
} from "@/server/data/conversations";
import { insertMessage, listMessages } from "@/server/data/messages";
import { createProvider, fallbackProviderIds } from "@/server/ai/factory";
import type { ChatProvider } from "@/server/ai/types";
import { ProviderError } from "@/server/ai/errors";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

vi.mock("@/server/data/conversations", () => ({
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  updateConversationProvider: vi.fn(),
}));

vi.mock("@/server/data/messages", () => ({
  insertMessage: vi.fn(),
  listMessages: vi.fn(),
}));

vi.mock("@/server/config/env", () => ({
  getAiSettings: vi.fn(() => ({ provider: "mock", model: "mock-1" })),
  maxContextMessages: vi.fn(() => 20),
}));

vi.mock("@/server/ai/factory", () => ({
  createProvider: vi.fn(),
  fallbackProviderIds: vi.fn(() => []),
}));

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "a@example.com" };
const CONV_ID = "22222222-2222-4222-8222-222222222222";

const CONVERSATION = {
  id: CONV_ID,
  user_id: USER.id,
  title: "New chat",
  provider: "mock",
  model: "mock-1",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

let messageSeq = 0;

function saved(message: {
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
}) {
  return {
    id: `m${++messageSeq}`,
    conversation_id: message.conversation_id,
    role: message.role,
    content: message.content,
    created_at: "2026-01-01T00:00:00.000Z",
  } as const;
}

function stubProvider(
  chunks: string[],
  err?: ProviderError,
  overrides: Partial<Pick<ChatProvider, "id" | "displayName" | "defaultModel" | "availableModels">> = {}
): ChatProvider {
  return {
    id: overrides.id ?? "mock",
    displayName: overrides.displayName ?? "Mock",
    defaultModel: overrides.defaultModel ?? "mock-1",
    availableModels: overrides.availableModels ?? ["mock-1"],
    async *chat() {
      for (const c of chunks) {
        await Promise.resolve();
        yield { delta: c };
      }
      if (err) throw err;
    },
  } as ChatProvider;
}

async function readEvents(res: Response) {
  const text = await res.text();
  return text
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => {
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const data = /^data: (.+)$/m.exec(frame)?.[1];
      return { event, data: data ? (JSON.parse(data) as Record<string, unknown>) : undefined };
    });
}

function chatRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  messageSeq = 0;
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: USER }, error: null }) },
  } as never);
  vi.mocked(createConversation).mockResolvedValue(CONVERSATION);
  vi.mocked(getConversation).mockResolvedValue(CONVERSATION);
  vi.mocked(listMessages).mockResolvedValue([
    { ...saved({ conversation_id: CONV_ID, role: "user", content: "Hello" }) },
    { ...saved({ conversation_id: CONV_ID, role: "assistant", content: "Hi" }) },
  ]);
  vi.mocked(insertMessage).mockImplementation(async (_s, cid, role, content) =>
    saved({ conversation_id: cid, role, content })
  );
  vi.mocked(fallbackProviderIds).mockReturnValue([]);
  vi.mocked(updateConversationProvider).mockResolvedValue(CONVERSATION);
});

describe("POST /api/chat", () => {
  it("creates a conversation, persists both messages and streams deltas + done", async () => {
    vi.mocked(createProvider).mockReturnValue(stubProvider(["Hel", "lo"]));

    const res = await POST(chatRequest({ content: "A brand new conversation" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const events = await readEvents(res);
    expect(events.map((e) => e.event)).toEqual(["delta", "delta", "done"]);
    expect(events[0].data).toEqual({ delta: "Hel" });
    expect(events[1].data).toEqual({ delta: "lo" });

    expect(createConversation).toHaveBeenCalledWith(expect.anything(), USER.id, {
      title: "A brand new conversation",
      provider: "mock",
      model: "mock-1",
    });
    expect(insertMessage).toHaveBeenNthCalledWith(1, expect.anything(), CONV_ID, "user", "A brand new conversation");
    expect(insertMessage).toHaveBeenNthCalledWith(2, expect.anything(), CONV_ID, "assistant", "Hello");
    const done = events[2].data as { conversationId: string; message: { content: string } };
    expect(done.conversationId).toBe(CONV_ID);
    expect(done.message.content).toBe("Hello");
  });

  it("continues an existing owned conversation with bounded context", async () => {
    vi.mocked(createProvider).mockReturnValue(stubProvider(["ok"]));

    await POST(chatRequest({ conversationId: CONV_ID, content: "Next turn" }));

    expect(getConversation).toHaveBeenCalledWith(expect.anything(), CONV_ID, USER.id);
    expect(createConversation).not.toHaveBeenCalled();
  });

  it("passes through an explicit provider and model override", async () => {
    const provider = stubProvider(["ok"]);
    vi.mocked(createProvider).mockReturnValue(provider);

    await POST(
      chatRequest({ conversationId: CONV_ID, content: "x", provider: "anthropic", model: "claude-3-5-sonnet-latest" })
    );

    expect(createProvider).toHaveBeenCalledWith("anthropic", {
      model: "claude-3-5-sonnet-latest",
    });
  });

  it("returns the user message history as provider context", async () => {
    const provider = stubProvider(["ok"]);
    const chatSpy = vi.spyOn(provider, "chat");
    vi.mocked(createProvider).mockReturnValue(provider);

    await POST(chatRequest({ conversationId: CONV_ID, content: "Next turn" }));

    expect(chatSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi" },
        ],
        model: undefined,
      })
    );
  });

  it("streams an error frame and skips persisting partial output on a mid-stream failure", async () => {
    vi.mocked(createProvider).mockReturnValue(
      stubProvider(["par"], new ProviderError("mock", "RATE_LIMITED", "limit", true, 429))
    );

    const res = await POST(chatRequest({ content: "trigger" }));
    const events = await readEvents(res);

    expect(events.map((e) => e.event)).toEqual(["delta", "error"]);
    expect(events[1].data).toEqual({ code: "rate_limited", message: "AI provider limit reached. Try again shortly." });
    // Only the user message was saved; the partial reply was not.
    expect(insertMessage).toHaveBeenNthCalledWith(1, expect.anything(), CONV_ID, "user", "trigger");
    expect(insertMessage).toHaveBeenCalledTimes(1);
  });

  it("returns a JSON error when the provider cannot be constructed (no key)", async () => {
    vi.mocked(createProvider).mockImplementation(() => {
      throw new ProviderError("openai", "CONFIG", "No API key.");
    });

    const res = await POST(chatRequest({ provider: "openai", content: "x" }));
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.error.code).toBe("config");
  });

  it("returns 404 when targeting a conversation another user owns", async () => {
    vi.mocked(getConversation).mockResolvedValue(null);
    const res = await POST(chatRequest({ conversationId: CONV_ID, content: "x" }));
    expect(res.status).toBe(404);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    } as never);
    const res = await POST(chatRequest({ content: "x" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid input", async () => {
    const res = await POST(chatRequest({ content: "" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation");
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("deterministically resolves the mock provider when none is configured", async () => {
    const provider = stubProvider(["hi"]);
    vi.mocked(createProvider).mockReturnValue(provider);
    const res = await POST(chatRequest({ content: "hello there" }));
    expect(res.status).toBe(200);
    expect((await readEvents(res))[0].data).toEqual({ delta: "hi" });
  });

  describe("automatic provider fallback", () => {
    it("emits fallback and answers from another provider on a pre-stream quota error", async () => {
      const openai = stubProvider(
        [],
        new ProviderError("openai", "QUOTA_EXCEEDED", "no credits", true, 429),
        { id: "openai" }
      );
      const gemini = stubProvider(["Hel", "lo"], undefined, {
        id: "gemini",
        defaultModel: "gemini-2.5-flash",
      });
      vi.mocked(createProvider).mockImplementation((id) =>
        id === "openai" ? openai : gemini
      );
      vi.mocked(fallbackProviderIds).mockReturnValue(["gemini"]);

      const res = await POST(
        chatRequest({ conversationId: CONV_ID, content: "retry me", provider: "openai", model: "gpt-4o-mini" })
      );
      const events = await readEvents(res);

      expect(events.map((e) => e.event)).toEqual(["fallback", "delta", "delta", "done"]);
      expect(events[0].data).toEqual({ provider: "gemini" });
      expect(events[0].data).not.toHaveProperty("model");
      const done = events[3].data as { provider: string; model: string };
      expect(done.provider).toBe("gemini");
      expect(done.model).toBe("gemini-2.5-flash");
      // Assistant reply persisted; conversation re-labeled to the provider that answered.
      expect(insertMessage).toHaveBeenNthCalledWith(2, expect.anything(), CONV_ID, "assistant", "Hello");
      expect(updateConversationProvider).toHaveBeenCalledWith(
        expect.anything(),
        CONV_ID,
        USER.id,
        "gemini",
        "gemini-2.5-flash"
      );
    });

    it("does not fall back when quota is exhausted after deltas already streamed", async () => {
      const openai = stubProvider(
        ["par"],
        new ProviderError("openai", "QUOTA_EXCEEDED", "no credits", true, 429),
        { id: "openai" }
      );
      vi.mocked(createProvider).mockImplementation(() => openai);
      vi.mocked(fallbackProviderIds).mockReturnValue(["gemini"]);

      const res = await POST(chatRequest({ provider: "openai", content: "x" }));
      const events = await readEvents(res);

      expect(events.map((e) => e.event)).toEqual(["delta", "error"]);
      expect(events[1].data).toEqual({
        code: "quota_exceeded",
        message: "AI provider limit reached. Try again shortly.",
      });
      expect(createProvider).toHaveBeenCalledTimes(1);
      expect(insertMessage).toHaveBeenCalledTimes(1);
      expect(updateConversationProvider).not.toHaveBeenCalled();
    });

    it("does not fall back on non-quota provider errors", async () => {
      const openai = stubProvider(
        [],
        new ProviderError("openai", "RATE_LIMITED", "slow down", true, 429),
        { id: "openai" }
      );
      vi.mocked(createProvider).mockImplementation(() => openai);
      vi.mocked(fallbackProviderIds).mockReturnValue(["gemini"]);

      const res = await POST(chatRequest({ provider: "openai", content: "x" }));
      const events = await readEvents(res);

      expect(events.map((e) => e.event)).toEqual(["error"]);
      expect(events[0].data).toEqual({
        code: "rate_limited",
        message: "AI provider limit reached. Try again shortly.",
      });
      expect(updateConversationProvider).not.toHaveBeenCalled();
    });
  });
});