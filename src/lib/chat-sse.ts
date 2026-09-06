export interface ApiErrorBody {
  error: { code: string; message: string };
}

/** Error returned by the API as a non-streaming JSON response. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export interface ChatSseFrame {
  event: "delta" | "done" | "error" | "fallback";
  data: Record<string, unknown>;
}

export interface ChatSseHandlers {
  onDelta?: (delta: string) => void;
  onDone?: (payload: {
    conversationId: string;
    message: Record<string, unknown>;
    provider?: string;
    model?: string;
  }) => void;
  onError?: (payload: { code: string; message: string }) => void;
  onFallback?: (payload: { provider: string }) => void;
}

function parseFrame(frame: string): ChatSseFrame | null {
  const m = frame.match(/^event: (.+)$/m);
  const d = frame.match(/^data: (.+)$/m);
  if (!d) return null;
  const event = m?.[1];
  if (event !== "delta" && event !== "done" && event !== "error" && event !== "fallback") return null;
  try {
    return { event, data: JSON.parse(d[1]) as Record<string, unknown> };
  } catch {
    return null;
  }
}

/**
 * Reads a `/api/chat` response. Non-streaming (JSON) error responses are
 * surfaced as ApiRequestError; SSE frames are dispatched to the handlers.
 * Resolves normally when the stream closes or the caller aborts.
 */
export async function readSseStream(
  response: Response,
  handlers: ChatSseHandlers
): Promise<void> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    if (contentType.includes("application/json")) {
      const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
      throw new ApiRequestError(
        response.status,
        body?.error?.code ?? "internal",
        body?.error?.message ?? `Request failed (${response.status}).`
      );
    }
    throw new ApiRequestError(response.status, "internal", `Request failed (${response.status}).`);
  }

  if (!contentType.includes("text/event-stream")) {
    throw new ApiRequestError(200, "internal", "Expected a stream response.");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new ApiRequestError(200, "internal", "Empty response stream.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  const dispatch = (frame: string) => {
    const parsed = parseFrame(frame);
    if (!parsed) return;
    if (parsed.event === "delta") handlers.onDelta?.(String(parsed.data.delta ?? ""));
    else if (parsed.event === "done") {
      handlers.onDone?.({
        conversationId: String(parsed.data.conversationId),
        message: (parsed.data.message ?? {}) as Record<string, unknown>,
        provider: parsed.data.provider !== undefined ? String(parsed.data.provider) : undefined,
        model: parsed.data.model !== undefined ? String(parsed.data.model) : undefined,
      });
    } else if (parsed.event === "error") {
      handlers.onError?.({
        code: String(parsed.data.code ?? "internal"),
        message: String(parsed.data.message ?? "An unexpected error occurred."),
      });
    } else if (parsed.event === "fallback") {
      handlers.onFallback?.({ provider: String(parsed.data.provider ?? "") });
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      dispatch(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) dispatch(buffer);
}