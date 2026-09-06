import { NextResponse } from "next/server";
import { listAvailableProviders } from "@/server/ai/factory";

export const runtime = "nodejs";

export function GET() {
  // Only surfaced for logged-in clients is handled client-side; the list
  // itself exposes no secrets, only provider descriptors.
  return NextResponse.json({ providers: listAvailableProviders() });
}