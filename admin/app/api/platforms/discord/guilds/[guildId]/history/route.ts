import { NextRequest, NextResponse } from "next/server";
import { deleteDiscordGuildChatHistory } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ guildId: string }>;
};

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { guildId } = await context.params;
  return NextResponse.json(deleteDiscordGuildChatHistory(guildId));
}
