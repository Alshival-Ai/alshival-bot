import { NextResponse } from "next/server";
import { startPlatform } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return NextResponse.json(await startPlatform("discord"));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start Discord." },
      { status: 502 },
    );
  }
}
