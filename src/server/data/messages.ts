import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { ChatRole } from "@/server/ai/types";
import { supabaseErrorToAppError } from "./errors";

export interface MessageRecord {
  id: string;
  conversation_id: string;
  role: ChatRole;
  content: string;
  created_at: string;
}

/**
 * Messages of any conversation the signed-in user owns (enforced by RLS).
 * To 404 on someone else's conversation, handlers check ownership first.
 */
export async function listMessages(
  supabase: SupabaseClient<Database>,
  conversationId: string,
  limit = 500
): Promise<MessageRecord[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, conversation_id, role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw supabaseErrorToAppError(error);
  return data ?? [];
}

export async function insertMessage(
  supabase: SupabaseClient<Database>,
  conversationId: string,
  role: ChatRole,
  content: string
): Promise<MessageRecord> {
  const { data, error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, role, content })
    .select("id, conversation_id, role, content, created_at")
    .single();

  if (error) throw supabaseErrorToAppError(error);
  return data;
}