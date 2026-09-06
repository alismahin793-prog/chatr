import { describe, expect, it, vi } from "vitest";
import { ApiRequestError, readSseStream } from "@/lib/chat-sse";

function sseResponse(
  frames: Array<{ event: "delta" | "done" | "error" | "fallback"; data: unknown }>
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) {
        controller.enqueue(
          encoder.encode(`event: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`)
        );
      }
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

describe("readSseStream", () => {
  it("dispatches delta, done and error events in order", async () => {
    const onDelta = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    await readSseStream(
      sseResponse([
        { event: "delta", data: { delta: "Hi" } },
        { event: "delta", data: { delta: " there" } },
        { event: "done", data: { conversationId: "cv1", message: { id: "m1" } } },
        { event: "error", data: { code: "rate_limited", message: "Slow down" } },
      ]),
      { onDelta, onDone, onError }
    );

    expect(onDelta.mock.calls.map((c) => c[0])).toEqual(["Hi", " there"]);
    expect(onDone).toHaveBeenCalledWith({ conversationId: "cv1", message: { id: "m1" } });
    expect(onError).toHaveBeenCalledWith({ code: "rate_limited", message: "Slow down" });
  });

  it("dispatches a trailing frame without a final blank line", async () => {
    const onDelta = vi.fn();
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode('event: delta\ndata: {"delta":"tail"}'));
        c.close();
      },
    });
    await readSseStream(
      new Response(body, { headers: { "content-type": "text/event-stream" } }),
      { onDelta }
    );
    expect(onDelta).toHaveBeenCalledWith("tail");
  });

  it("dispatches a fallback frame and forwards provider/model on done", async () => {
    const onFallback = vi.fn();
    const onDone = vi.fn();

    await readSseStream(
      sseResponse([
        { event: "fallback", data: { provider: "gemini" } },
        { event: "delta", data: { delta: "ok" } },
        {
          event: "done",
          data: { conversationId: "cv2", message: { id: "m2" }, provider: "gemini", model: "gemini-2.5-flash" },
        },
      ]),
      { onFallback, onDone }
    );

    expect(onFallback).toHaveBeenCalledWith({ provider: "gemini" });
    expect(onDone).toHaveBeenCalledWith({
      conversationId: "cv2",
      message: { id: "m2" },
      provider: "gemini",
      model: "gemini-2.5-flash",
    });
  });

  it("ignores unknown event types and malformed frames", async () => {
    const onDelta = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"foo":1}\n\nevent: ping\ndata: x\n\nnot sse'));
        c.close();
      },
    });
    await readSseStream(
      new Response(body, { headers: { "content-type": "text/event-stream" } }),
      { onDelta }
    );
    expect(onDelta).not.toHaveBeenCalled();
  });

  it("throws an ApiRequestError with code+message for a JSON error response", async () => {
    const make = () =>
      new Response(
        JSON.stringify({ error: { code: "unauthorized", message: "Auth required." } }),
        { status: 401, headers: { "content-type": "application/json" } }
      );
    await expect(readSseStream(make(), {})).rejects.toBeInstanceOf(ApiRequestError);
    await expect(readSseStream(make(), {})).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
      message: "Auth required.",
    });
  });

  it("rejects a non-JSON, non-SSE error response", async () => {
    const res = new Response("server exploded", { status: 500 });
    await expect(readSseStream(res, {})).rejects.toMatchObject({
      status: 500,
      code: "internal",
    });
  });
});