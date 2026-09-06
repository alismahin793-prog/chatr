import type { ChatMessage, ProviderId } from "@/server/ai/types";
import { createProvider } from "@/server/ai/factory";
import { ProviderError } from "@/server/ai/errors";
import { requireUser, readJsonBody, toApiError, providerErrorMessage } from "@/server/api/helpers";
import { getAiSettings, maxContextMessages } from "@/server/config/env";
import {
  createConversation,
  getConversation,
  type ConversationRecord,
} from "@/server/data/conversations";
import { insertMessage, listMessages } from "@/server/data/messages";
import { NotFoundError, ValidationError } from "@/server/errors";
import { formatZodError, sendMessageSchema } from "@/server/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function sendEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: "delta" | "done" | "error",
  payload: unknown
) {
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
}

function userFacingMessage(err: ProviderError): string {
  return providerErrorMessage(err.code);
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await readJsonBody<unknown>(request);
    const parsed = sendMessageSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).message);

    const { conversationId, content, provider: providerId, model } = parsed.data;

    let conversation: ConversationRecord;
    if (conversationId) {
      const found = await getConversation(supabase, conversationId, user.id);
      if (!found) throw new NotFoundError("Conversation not found.");
      conversation = found;
    } else {
      const settings = getAiSettings();
      conversation = await createConversation(supabase, user.id, {
        title: content.slice(0, 40),
        provider: providerId ?? settings.provider,
        model: model ?? settings.model,
      });
    }

    await insertMessage(supabase, conversation.id, "user", content);

    const history = await listMessages(supabase, conversation.id);
    const context: ChatMessage[] = history
      .slice(-maxContextMessages())
      .map((m) => ({ role: m.role, content: m.content }));

    const activeProvider: ProviderId =
      providerId ?? (conversation.provider as ProviderId | null) ?? getAiSettings().provider;
    const provider = createProvider(activeProvider, { model: model ?? undefined });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let assistantText = "";
        try {
          for await (const chunk of provider.chat({
            messages: context,
            model: model ?? undefined,
            signal: request.signal,
          })) {
            assistantText += chunk.delta;
            sendEvent(controller, "delta", { delta: chunk.delta });
          }

          const assistantMessage = await insertMessage(
            supabase,
            conversation.id,
            "assistant",
            assistantText
          );
          sendEvent(controller, "done", {
            conversationId: conversation.id,
            message: assistantMessage,
          });
        } catch (err) {
          if (request.signal.aborted) {
            // Client went away; partial output is intentionally not persisted.
            return;
          }
          if (err instanceof ProviderError) {
            sendEvent(controller, "error", {
              code: err.code.toLowerCase(),
              message: userFacingMessage(err),
            });
          } else {
            console.error("Unhandled chat stream error:", err);
            sendEvent(controller, "error", {
              code: "internal",
              message: "An unexpected error occurred.",
            });
          }
        } finally {
          try {
            controller.close();
          } catch {
            // Stream already closed by an error path.
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  } catch (err) {
    return toApiError(err);
  }
}