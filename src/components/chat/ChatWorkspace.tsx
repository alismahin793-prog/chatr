"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiRequestError, readSseStream } from "@/lib/chat-sse";
import type { ConversationSummary } from "@/server/data/conversations";
import type { MessageRecord } from "@/server/data/messages";

interface ProviderDescriptor {
  id: string;
  displayName: string;
  defaultModel: string;
  availableModels: string[];
}

interface ChatWorkspaceProps {
  userId: string;
  initialConversations: ConversationSummary[];
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    throw new ApiRequestError(res.status, body?.error?.code ?? "internal", body?.error?.message ?? "Request failed.");
  }
  return (await res.json()) as T;
}

export default function ChatWorkspace({ userId, initialConversations }: ChatWorkspaceProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>(initialConversations);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [activeProvider, setActiveProvider] = useState<string>("mock");
  const [activeModel, setActiveModel] = useState<string>("mock-1");

  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/models")
      .then(async (res) => {
        const body = await jsonOrThrow<{ providers: ProviderDescriptor[] }>(res);
        setProviders(body.providers);
        if (body.providers.length > 0) {
          setActiveProvider(body.providers[0].id);
          setActiveModel(body.providers[0].defaultModel);
        }
      })
      .catch(() => {
        // Provider list is a convenience; keep the mock default.
      });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({
      behavior: "smooth",
      block: "end",
    });
  }, [messages, streamText]);

  const selectConversation = useCallback(async (id: string) => {
    abortRef.current?.abort();
    setActiveId(id);
    setStreamText(null);
    setStreamError(null);
    setFallbackNote(null);
    setBusy(true);
    try {
      const body = await jsonOrThrow<{ messages: MessageRecord[] }>(
        await fetch(`/api/conversations/${id}/messages`)
      );
      setMessages(body.messages);
    } catch {
      setMessages([]);
    } finally {
      setBusy(false);
    }
  }, []);

  const updateProvider = useCallback((id: string) => {
    setActiveProvider(id);
    const next = providers.find((p) => p.id === id);
    setActiveModel(next?.defaultModel ?? "mock-1");
  }, [providers]);

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || streamText !== null) return;

      const optimistic: MessageRecord = {
        id: `local-user-${Date.now()}`,
        conversation_id: activeId ?? "pending",
        role: "user",
        content: trimmed,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      setInput("");
      setStreamText("");
      setStreamError(null);
      setFallbackNote(null);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            conversationId: activeId ?? undefined,
            content: trimmed,
            provider: providers.some((p) => p.id === activeProvider) ? activeProvider : undefined,
            model: providers.some((p) => p.id === activeProvider) ? activeModel : undefined,
          }),
          signal: controller.signal,
        });

        await readSseStream(res, {
          onDelta: (delta) => setStreamText((prev) => `${prev ?? ""}${delta}`),
          onFallback: ({ provider }) => {
            const name = providers.find((p) => p.id === provider)?.displayName ?? provider;
            setFallbackNote(
              `${activeProvider} hit its usage limit — continuing with ${name}.`
            );
          },
          onDone: ({ conversationId, message, provider, model }) => {
            const saved = message as unknown as MessageRecord;
            setMessages((prev) => [...prev, saved]);
            setStreamText(null);
            if (provider) {
              setActiveProvider(provider);
              if (model) setActiveModel(model);
            }
            if (conversationId && conversationId !== activeId) {
              setActiveId(conversationId);
              setConversations((prev) =>
                prev.some((c) => c.id === conversationId)
                  ? prev
                  : [
                      {
                        id: conversationId,
                        title: trimmed.slice(0, 40),
                        provider: provider ?? activeProvider,
                        model: model ?? activeModel,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                      },
                      ...prev,
                    ]
              );
            }
          },
          onError: ({ message }) => {
            setStreamText(null);
            setStreamError(message);
          },
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setStreamText(null);
        setStreamError(err instanceof Error ? err.message : "An unexpected error occurred.");
      } finally {
        setBusy(false);
      }
    },
    [activeId, activeModel, activeProvider, providers, streamText]
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      if (activeId === id) setActiveId(null);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        // Non-fatal; the list refresh below reconciles.
      }
      if (activeId === id) setMessages([]);
    },
    [activeId]
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setStreamText(null);
  }, []);

  return (
    <main className="flex h-screen bg-zinc-50 text-zinc-900">
      <aside className="flex w-72 flex-col border-r border-zinc-200 bg-white">
        <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
          <span className="grid size-7 place-items-center rounded-lg bg-indigo-600 text-xs font-bold text-white">
            C
          </span>
          <span className="font-semibold">Chatr</span>
        </div>

        <button
          type="button"
          onClick={() => {
            setActiveId(null);
            setMessages([]);
            setStreamError(null);
            setStreamText(null);
            setFallbackNote(null);
          }}
          className="m-3 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          + New chat
        </button>

        <nav className="flex-1 overflow-auto px-2 pb-2">
          {conversations.length === 0 && (
            <p className="px-2 py-3 text-xs text-zinc-400">No conversations yet.</p>
          )}
          <ul className="space-y-1">
            {conversations.map((c) => (
              <li key={c.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => selectConversation(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void selectConversation(c.id);
                  }}
                  className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm ${
                    activeId === c.id ? "bg-indigo-50 text-indigo-900" : "hover:bg-zinc-100"
                  }`}
                >
                  <span className="flex-1 truncate">{c.title}</span>
                  <button
                    type="button"
                    aria-label={`Delete conversation ${c.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteConversation(c.id);
                    }}
                    className="hidden text-zinc-400 hover:text-red-600 group-hover:block"
                  >
                    x
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-zinc-200 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
            Signed in
          </div>
          <p className="mt-1 truncate text-xs text-zinc-400">{userId.slice(0, 12)}…</p>
          <form action="/auth/logout" method="post" className="mt-2">
            <button
              type="submit"
              className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <section className="flex flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 bg-white px-6 py-3">
          <label className="flex items-center gap-2 text-sm text-zinc-600">
            Provider
            <select
              value={activeProvider}
              onChange={(e) => updateProvider(e.target.value)}
              className="rounded-md border border-zinc-300 px-2 py-1 text-sm"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-600">
            Model
            <select
              value={activeModel}
              onChange={(e) => setActiveModel(e.target.value)}
              className="rounded-md border border-zinc-300 px-2 py-1 text-sm"
            >
              {(providers.find((p) => p.id === activeProvider)?.availableModels ?? [activeModel]).map(
                (m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                )
              )}
            </select>
          </label>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {messages.length === 0 && streamText === null && (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-zinc-400">
                {streamError ? streamError : "Start a conversation below."}
              </p>
            </div>
          )}

          <div className="mx-auto max-w-3xl space-y-4">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
                    m.role === "user"
                      ? "bg-indigo-600 text-white"
                      : "border border-zinc-200 bg-white text-zinc-800"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {streamText !== null && (
              <div className="flex justify-start">
                <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-800">
                  {streamText}
                </div>
              </div>
            )}

            {fallbackNote && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
                {fallbackNote}
              </div>
            )}

            {streamError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                {streamError}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="border-t border-zinc-200 bg-white px-6 py-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const value = input;
              if (value.trim()) void sendMessage(value);
            }}
            className="mx-auto flex max-w-3xl gap-2"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (input.trim()) void sendMessage(input);
                }
              }}
              placeholder="Type a message…"
              rows={1}
              className="flex-1 resize-none rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
            {streamText !== null ? (
              <button
                type="button"
                onClick={stopStreaming}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
              >
                Send
              </button>
            )}
          </form>
        </div>
      </section>
    </main>
  );
}