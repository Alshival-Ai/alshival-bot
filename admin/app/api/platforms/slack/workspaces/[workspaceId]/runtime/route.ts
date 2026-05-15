import { NextRequest, NextResponse } from "next/server";
import { startSlackWorkspace, stopSlackWorkspace } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ workspaceId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const body = (await request.json()) as { action?: unknown };
  const action = body.action === "stop" ? "stop" : "start";

  try {
    const status =
      action === "start" ? await startSlackWorkspace(workspaceId) : await stopSlackWorkspace(workspaceId);

    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update Slack workspace runtime." },
      { status: 502 },
    );
  }
}
