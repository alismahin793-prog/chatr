import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listConversations } from "@/server/data/conversations";
import ChatWorkspace from "@/components/chat/ChatWorkspace";

export default async function ChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const conversations = await listConversations(supabase, user.id);

  return <ChatWorkspace userId={user.id} initialConversations={conversations} />;
}