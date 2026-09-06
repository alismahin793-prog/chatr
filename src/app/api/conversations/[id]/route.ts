import { NextResponse } from "next/server";
import {
  deleteConversation,
  getConversation,
  updateConversationTitle,
} from "@/server/data/conversations";
import {
  conversationIdSchema,
  formatZodError,
  updateConversationSchema,
} from "@/server/validation/schemas";
import { NotFoundError, ValidationError } from "@/server/errors";
import { requireUser, readJsonBody, toApiError } from "@/server/api/helpers";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const { supabase, user } = await requireUser();
    const conversation = await getConversation(supabase, id, user.id);
    if (!conversation) throw new NotFoundError("Conversation not found.");
    return NextResponse.json({ conversation });
  } catch (err) {
    return toApiError(err);
  }
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const parsedId = conversationIdSchema.safeParse({ id });
    if (!parsedId.success) throw new ValidationError(formatZodError(parsedId.error).message);

    const body = await readJsonBody<unknown>(request);
    const parsedBody = updateConversationSchema.safeParse(body);
    if (!parsedBody.success) {
      throw new ValidationError(formatZodError(parsedBody.error).message);
    }

    const { supabase, user } = await requireUser();
    const conversation = await updateConversationTitle(supabase, id, user.id, parsedBody.data.title);
    return NextResponse.json({ conversation });
  } catch (err) {
    return toApiError(err);
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const parsedId = conversationIdSchema.safeParse({ id });
    if (!parsedId.success) throw new ValidationError(formatZodError(parsedId.error).message);

    const { supabase, user } = await requireUser();
    await deleteConversation(supabase, id, user.id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toApiError(err);
  }
}