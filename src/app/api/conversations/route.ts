import { NextResponse } from "next/server";
import { createConversation, listConversations } from "@/server/data/conversations";
import { requireUser, readJsonBody, toApiError } from "@/server/api/helpers";
import {
  createConversationSchema,
  formatZodError,
} from "@/server/validation/schemas";
import { ValidationError } from "@/server/errors";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const conversations = await listConversations(supabase, user.id);
    return NextResponse.json({ conversations });
  } catch (err) {
    return toApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await readJsonBody<unknown>(request);
    const parsed = createConversationSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(formatZodError(parsed.error).message);
    }
    const conversation = await createConversation(supabase, user.id, parsed.data);
    return NextResponse.json({ conversation }, { status: 201 });
  } catch (err) {
    return toApiError(err);
  }
}