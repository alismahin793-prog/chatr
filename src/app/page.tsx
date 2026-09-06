import { redirect } from "next/navigation";

export default function Home() {
  // Route protection lives in src/proxy.ts: unauthenticated visitors end up
  // on /login, signed-in users land in /chat.
  redirect("/chat");
}