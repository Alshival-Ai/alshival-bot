import { NextResponse } from "next/server";
import { startPlatform } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return NextResponse.json(await startPlatform("slack"));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start Slack bot." },
      { status: 502 },
    );
  }
}
