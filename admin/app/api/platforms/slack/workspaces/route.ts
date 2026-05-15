import { NextResponse } from "next/server";
import { getSlackWorkspaces } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getSlackWorkspaces());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load Slack workspaces." },
      { status: 502 },
    );
  }
}
