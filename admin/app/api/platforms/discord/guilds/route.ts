import { NextResponse } from "next/server";
import { getDiscordGuilds } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getDiscordGuilds());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load Discord guilds." },
      { status: 502 },
    );
  }
}
