import { NextResponse } from "next/server";
import { getConversation } from "@/server/data/conversations";
import { listMessages } from "@/server/data/messages";
import { conversationIdSchema, formatZodError } from "@/server/validation/schemas";
import { NotFoundError, ValidationError } from "@/server/errors";
import { requireUser, toApiError } from "@/server/api/helpers";
import { CAPABILITIES, requireCapability } from "@/server/auth/capabilities";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const parsedId = conversationIdSchema.safeParse({ id });
    if (!parsedId.success) throw new ValidationError(formatZodError(parsedId.error).message);

    const { supabase, user } = await requireUser();
    await requireCapability(supabase, user.id, CAPABILITIES.CHAT);
    const conversation = await getConversation(supabase, id, user.id);
    if (!conversation) throw new NotFoundError("Conversation not found.");

    const messages = await listMessages(supabase, id);
    return NextResponse.json({ messages });
  } catch (err) {
    return toApiError(err);
  }
}