import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { GET as listGet, POST as createPost } from "@/app/api/conversations/route";
import {
  GET as singleGet,
  PATCH as singlePatch,
  DELETE as singleDelete,
} from "@/app/api/conversations/[id]/route";
import { GET as messagesGet } from "@/app/api/conversations/[id]/messages/route";
import { createClient } from "@/lib/supabase/server";
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  updateConversationTitle,
} from "@/server/data/conversations";
import { listMessages } from "@/server/data/messages";
import { NotFoundError } from "@/server/errors";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/server/data/conversations", () => ({
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  createConversation: vi.fn(),
  updateConversationTitle: vi.fn(),
  deleteConversation: vi.fn(),
}));

vi.mock("@/server/data/messages", () => ({
  listMessages: vi.fn(),
}));

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "a@example.com" };
const ID = "22222222-2222-4222-8222-222222222222";

const CONVERSATION = {
  id: ID,
  user_id: USER.id,
  title: "My chat",
  provider: "mock",
  model: "mock-1",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function mockAuth(user: unknown = USER) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
  } as never);
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth();
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
});

describe("GET /api/conversations", () => {
  it("lists the user's conversations", async () => {
    vi.mocked(listConversations).mockResolvedValue([CONVERSATION]);
    const res = await listGet();
    expect(res.status).toBe(200);
    expect((await res.json()).conversations).toEqual([CONVERSATION]);
    expect(listConversations).toHaveBeenCalledWith(expect.anything(), USER.id);
  });

  it("maps repo errors to an error response", async () => {
    vi.mocked(listConversations).mockRejectedValue(new NotFoundError("boom"));
    const res = await listGet();
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("returns 401 when not authenticated", async () => {
    mockAuth(null);
    const res = await listGet();
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
  });
});

describe("POST /api/conversations", () => {
  it("creates a conversation and returns 201", async () => {
    vi.mocked(createConversation).mockResolvedValue(CONVERSATION);
    const res = await createPost(jsonRequest({ title: "My chat", provider: "mock" }));
    expect(res.status).toBe(201);
    expect((await res.json()).conversation.id).toBe(ID);
    expect(createConversation).toHaveBeenCalledWith(expect.anything(), USER.id, {
      title: "My chat",
      provider: "mock",
      model: undefined,
    });
  });

  it("rejects an invalid provider", async () => {
    const res = await createPost(jsonRequest({ title: "x", provider: "not-a-provider" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation");
    expect(createConversation).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    const res = await createPost(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation");
  });
});

describe("GET /api/conversations/[id]", () => {
  it("returns the conversation when owned", async () => {
    vi.mocked(getConversation).mockResolvedValue(CONVERSATION);
    const res = await singleGet(new Request("http://localhost/api"), ctx(ID));
    expect(res.status).toBe(200);
    expect((await res.json()).conversation.id).toBe(ID);
    expect(getConversation).toHaveBeenCalledWith(expect.anything(), ID, USER.id);
  });

  it("returns 404 for a conversation the user does not own", async () => {
    vi.mocked(getConversation).mockResolvedValue(null);
    const res = await singleGet(new Request("http://localhost/api"), ctx(ID));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });
});

describe("PATCH /api/conversations/[id]", () => {
  it("renames an owned conversation", async () => {
    vi.mocked(updateConversationTitle).mockResolvedValue({ ...CONVERSATION, title: "Renamed" });
    const res = await singlePatch(jsonRequest({ title: "Renamed" }), ctx(ID));
    expect(res.status).toBe(200);
    expect((await res.json()).conversation.title).toBe("Renamed");
    expect(updateConversationTitle).toHaveBeenCalledWith(expect.anything(), ID, USER.id, "Renamed");
  });

  it("rejects a non-uuid id", async () => {
    const res = await singlePatch(jsonRequest({ title: "x" }), ctx("not-a-uuid"));
    expect(res.status).toBe(400);
    expect(updateConversationTitle).not.toHaveBeenCalled();
  });

  it("rejects a missing title", async () => {
    const res = await singlePatch(jsonRequest({}), ctx(ID));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation");
  });
});

describe("DELETE /api/conversations/[id]", () => {
  it("deletes an owned conversation with 204", async () => {
    vi.mocked(deleteConversation).mockResolvedValue(undefined);
    const res = await singleDelete(new Request("http://localhost/api"), ctx(ID));
    expect(res.status).toBe(204);
    expect(deleteConversation).toHaveBeenCalledWith(expect.anything(), ID, USER.id);
  });

  it("maps not-found to 404", async () => {
    vi.mocked(deleteConversation).mockRejectedValue(new NotFoundError("Conversation not found."));
    const res = await singleDelete(new Request("http://localhost/api"), ctx(ID));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/conversations/[id]/messages", () => {
  const MESSAGES = [
    {
      id: "m1",
      conversation_id: ID,
      role: "user" as const,
      content: "hi",
      created_at: "2026-01-01",
    },
  ];

  it("lists messages for an owned conversation", async () => {
    vi.mocked(getConversation).mockResolvedValue(CONVERSATION);
    vi.mocked(listMessages).mockResolvedValue(MESSAGES);
    const res = await messagesGet(new Request("http://localhost/api"), ctx(ID));
    expect(res.status).toBe(200);
    expect((await res.json()).messages).toEqual(MESSAGES);
  });

  it("returns 404 when the conversation is not owned", async () => {
    vi.mocked(getConversation).mockResolvedValue(null);
    const res = await messagesGet(new Request("http://localhost/api"), ctx(ID));
    expect(res.status).toBe(404);
    expect(listMessages).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid id", async () => {
    const res = await messagesGet(new Request("http://localhost/api"), ctx("nope"));
    expect(res.status).toBe(400);
  });
});