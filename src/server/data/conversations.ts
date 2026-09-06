import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { NotFoundError } from "@/server/errors";
import { supabaseErrorToAppError } from "./errors";

export interface ConversationSummary {
  id: string;
  title: string;
  provider: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationRecord extends ConversationSummary {
  user_id: string;
}

export async function listConversations(
  supabase: SupabaseClient<Database>,
  userId: string,
  limit = 100
): Promise<ConversationSummary[]> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, title, provider, model, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw supabaseErrorToAppError(error);
  return data ?? [];
}

/** Returns the conversation if it belongs to `userId`, otherwise null. */
export async function getConversation(
  supabase: SupabaseClient<Database>,
  id: string,
  userId: string
): Promise<ConversationRecord | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw supabaseErrorToAppError(error);
  return data;
}

export async function createConversation(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: { title?: string; provider?: string | null; model?: string | null }
): Promise<ConversationRecord> {
  const { data, error } = await supabase
    .from("conversations")
    .insert({
      user_id: userId,
      title: input.title ?? "New chat",
      provider: input.provider ?? null,
      model: input.model ?? null,
    })
    .select("*")
    .single();

  if (error) throw supabaseErrorToAppError(error);
  return data;
}

export async function updateConversationTitle(
  supabase: SupabaseClient<Database>,
  id: string,
  userId: string,
  title: string
): Promise<ConversationRecord> {
  const { data, error } = await supabase
    .from("conversations")
    .update({ title })
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (error) throw supabaseErrorToAppError(error);
  if (!data) throw new NotFoundError("Conversation not found.");
  return data;
}

/** Deletes a conversation and (via cascade) its messages. */
export async function deleteConversation(
  supabase: SupabaseClient<Database>,
  id: string,
  userId: string
): Promise<void> {
  const { error, count } = await supabase
    .from("conversations")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) throw supabaseErrorToAppError(error);
  if (count === 0) throw new NotFoundError("Conversation not found.");
}