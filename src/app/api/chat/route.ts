import type { ChatMessage, ChatProvider, ProviderId } from "@/server/ai/types";
import { createProvider, fallbackProviderIds } from "@/server/ai/factory";
import { ProviderError } from "@/server/ai/errors";
import { recordAiRequest } from "@/server/ai/usage";
import { requireUser, readJsonBody, toApiError, providerErrorMessage } from "@/server/api/helpers";
import { CAPABILITIES, requireCapability } from "@/server/auth/capabilities";
import { createServiceClient } from "@/lib/supabase/service";
import { getAiSettings, maxContextMessages } from "@/server/config/env";
import {
  createConversation,
  getConversation,
  updateConversationProvider,
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
  event: "delta" | "done" | "error" | "fallback",
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
    await requireCapability(supabase, user.id, CAPABILITIES.CHAT);
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
    // Built before the stream starts so a missing key degrades to a JSON error.
    const primaryProvider = createProvider(activeProvider, { model: model ?? undefined });

    // Fallback chain: the selected provider first, then the other real
    // providers with a configured key (each using its own default model).
    const candidates: Array<{ id: ProviderId; model?: string; provider?: ChatProvider }> = [
      { id: activeProvider, model: model ?? undefined, provider: primaryProvider },
      ...fallbackProviderIds(activeProvider).map((id) => ({ id, provider: undefined })),
    ];

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let assistantText = "";
        let usedProviderId: ProviderId = activeProvider;
        let usedModel = model ?? undefined;
        try {
          for (let i = 0; i < candidates.length; i++) {
            const candidate = candidates[i];
            let streamedAny = false;
            try {
              const provider = candidate.provider ??
                createProvider(candidate.id, { model: candidate.model });
              usedProviderId = candidate.id;
              usedModel = candidate.model ?? provider.defaultModel;

              for await (const chunk of provider.chat({
                messages: context,
                model: candidate.model ?? undefined,
                signal: request.signal,
              })) {
                streamedAny = true;
                assistantText += chunk.delta;
                sendEvent(controller, "delta", { delta: chunk.delta });
              }
              break;
            } catch (err) {
              // Only fall back when the provider hit its usage quota before
              // streaming any content. Anything else (mid-stream failure,
              // auth, rate limit, invalid request) surfaces as an error.
              const lastCandidate = i === candidates.length - 1;
              const quotaBeforeStream =
                err instanceof ProviderError && err.code === "QUOTA_EXCEEDED" && !streamedAny;
              if (lastCandidate || !quotaBeforeStream) throw err;
              sendEvent(controller, "fallback", { provider: candidates[i + 1].id });
            }
          }

          if (usedProviderId !== conversation.provider) {
            await updateConversationProvider(
              supabase,
              conversation.id,
              user.id,
              usedProviderId,
              usedModel ?? ""
            );
          }

          const assistantMessage = await insertMessage(
            supabase,
            conversation.id,
            "assistant",
            assistantText
          );
          // Fire-and-forget telemetry: never throws, never delays the stream.
          void recordAiRequest(createServiceClient(), {
            userId: user.id,
            conversationId: conversation.id,
            provider: usedProviderId,
            model: usedModel ?? "",
          });
          sendEvent(controller, "done", {
            conversationId: conversation.id,
            message: assistantMessage,
            provider: usedProviderId,
            model: usedModel,
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