import { NextResponse } from "next/server";
import { stopPlatform } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return NextResponse.json(await stopPlatform("discord"));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not stop Discord." },
      { status: 502 },
    );
  }
}
