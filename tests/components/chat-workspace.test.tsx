// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ChatWorkspace from "@/components/chat/ChatWorkspace";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CONV_ID = "22222222-2222-4222-8222-222222222222";

const initialConversations = [
  {
    id: CONV_ID,
    title: "First chat",
    provider: "mock",
    model: "mock-1",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  },
];

function sseResponse(frames: Array<{ event: string; data: unknown }>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const f of frames) {
        c.enqueue(encoder.encode(`event: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`));
      }
      c.close();
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function typeMessage(text: string) {
  const textarea = screen.getByPlaceholderText("Type a message…");
  fireEvent.change(textarea, { target: { value: text } });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/models") {
        return jsonResponse(200, {
          providers: [
            {
              id: "mock",
              displayName: "Mock (development)",
              defaultModel: "mock-1",
              availableModels: ["mock-1"],
            },
          ],
        });
      }
      if (url === "/api/chat") {
        const body = JSON.parse(String(init?.body)) as { content: string };
        return sseResponse([
          { event: "delta", data: { delta: `Reply to ${body.content.slice(0, 12)}…` } },
          {
            event: "done",
            data: {
              conversationId: "33333333-3333-4333-8333-333333333333",
              message: {
                id: "m-1",
                conversation_id: "33333333-3333-4333-8333-333333333333",
                role: "assistant",
                content: `Reply to ${body.content.slice(0, 12)}…`,
                created_at: "2026-01-03T00:00:00.000Z",
              },
            },
          },
        ]);
      }
      if (url === `/api/conversations/${CONV_ID}/messages`) {
        return jsonResponse(200, {
          messages: [
            {
              id: "m-old",
              conversation_id: CONV_ID,
              role: "user",
              content: "stored question",
              created_at: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.startsWith("/api/conversations/") && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return jsonResponse(404, { error: { code: "not_found", message: "No route" } });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChatWorkspace", () => {
  it("renders the signed-in user and the initial conversation list", () => {
    render(<ChatWorkspace userId={USER_ID} initialConversations={initialConversations} />);
    expect(screen.getByText("First chat")).toBeTruthy();
    expect(screen.getByText("Chatr")).toBeTruthy();
    expect(screen.getByText("Signed in")).toBeTruthy();
  });

  it("loads the selected conversation's messages", async () => {
    render(<ChatWorkspace userId={USER_ID} initialConversations={initialConversations} />);
    fireEvent.click(screen.getByText("First chat"));
    await screen.findByText("stored question");
    expect(fetch).toHaveBeenCalledWith(`/api/conversations/${CONV_ID}/messages`);
  });

  it("sends a message and renders the streamed reply plus a new conversation", async () => {
    render(<ChatWorkspace userId={USER_ID} initialConversations={initialConversations} />);

    typeMessage("hello world");
    fireEvent.click(screen.getByText("Send"));

    expect(await screen.findByText("hello world")).toBeTruthy();
    // Streaming deltas plus the final done frame produce the assembled reply.
    expect(await screen.findByText("Reply to hello world…")).toBeTruthy();

    // The new conversation is added to the sidebar (alongside the message bubble).
    expect(await screen.findAllByText("hello world")).toHaveLength(2);

    const chatCall = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/chat");
    expect(chatCall).toBeTruthy();
    const body = JSON.parse(String(chatCall?.[1]?.body)) as { conversationId?: string };
    expect(body.conversationId).toBeUndefined();
  });

  it("shows a streamed error inline", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/models") {
        return jsonResponse(200, {
          providers: [{ id: "mock", displayName: "Mock", defaultModel: "mock-1", availableModels: [] }],
        });
      }
      if (url === "/api/chat") {
        return sseResponse([
          { event: "delta", data: { delta: "partial" } },
          { event: "error", data: { code: "rate_limited", message: "AI provider limit reached." } },
        ]);
      }
      return jsonResponse(404, { error: { code: "not_found", message: "nope" } });
    });

    render(<ChatWorkspace userId={USER_ID} initialConversations={[]} />);
    typeMessage("trigger error");
    fireEvent.click(screen.getByText("Send"));

    expect(await screen.findByText("AI provider limit reached.")).toBeTruthy();
  });

  it("surfaces non-streaming API errors as a message", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/models") {
        return jsonResponse(200, {
          providers: [{ id: "mock", displayName: "Mock", defaultModel: "mock-1", availableModels: [] }],
        });
      }
      if (url === "/api/chat") {
        return jsonResponse(500, { error: { code: "config", message: "AI provider is not configured." } });
      }
      return jsonResponse(404, { error: { code: "not_found", message: "nope" } });
    });

    render(<ChatWorkspace userId={USER_ID} initialConversations={[]} />);
    typeMessage("boom");
    fireEvent.click(screen.getByText("Send"));

    expect(await screen.findByText("AI provider is not configured.")).toBeTruthy();
  });

  it("shows a fallback notice and the reply when the server retries with another provider", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/models") {
        return jsonResponse(200, {
          providers: [
            { id: "openai", displayName: "OpenAI", defaultModel: "gpt-4o-mini", availableModels: [] },
            {
              id: "gemini",
              displayName: "Google Gemini",
              defaultModel: "gemini-3.6-flash",
              availableModels: [],
            },
          ],
        });
      }
      if (url === "/api/chat") {
        return sseResponse([
          { event: "fallback", data: { provider: "gemini" } },
          { event: "delta", data: { delta: "Answered!" } },
          {
            event: "done",
            data: {
              conversationId: CONV_ID,
              message: {
                id: "m-2",
                conversation_id: CONV_ID,
                role: "assistant",
                content: "Answered!",
                created_at: "2026-01-03T00:00:00.000Z",
              },
              provider: "gemini",
              model: "gemini-3.6-flash",
            },
          },
        ]);
      }
      return jsonResponse(404, { error: { code: "not_found", message: "nope" } });
    });

    render(<ChatWorkspace userId={USER_ID} initialConversations={[]} />);
    typeMessage("fallback me");
    fireEvent.click(screen.getByText("Send"));

    expect(await screen.findByText(/usage limit/)).toBeTruthy();
    expect(await screen.findByText(/Answered!/)).toBeTruthy();
  });

  it("deletes a conversation", async () => {
    render(<ChatWorkspace userId={USER_ID} initialConversations={initialConversations} />);
    fireEvent.click(screen.getByLabelText("Delete conversation First chat"));
    await waitFor(() => expect(screen.queryByText("First chat")).toBeNull());
    expect(fetch).toHaveBeenCalledWith(`/api/conversations/${CONV_ID}`, { method: "DELETE" });
  });
});