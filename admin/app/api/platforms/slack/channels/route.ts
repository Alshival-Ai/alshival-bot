import { NextRequest, NextResponse } from "next/server";
import { getSlackChannels } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? undefined;
    return NextResponse.json(await getSlackChannels(workspaceId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load Slack channels." },
      { status: 502 },
    );
  }
}
