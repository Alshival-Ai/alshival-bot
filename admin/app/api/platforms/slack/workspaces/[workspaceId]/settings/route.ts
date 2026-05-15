import { NextRequest, NextResponse } from "next/server";
import { stopSlackWorkspace } from "@/lib/backend";
import { deleteSlackWorkspaceSettings, setSlackWorkspaceEnabled } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ workspaceId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const body = (await request.json()) as { enabled?: unknown };

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean." }, { status: 400 });
  }

  try {
    if (!body.enabled) {
      await stopSlackWorkspace(workspaceId).catch(() => undefined);
    }

    return NextResponse.json({ workspace: setSlackWorkspaceEnabled(workspaceId, body.enabled) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update Slack workspace settings." },
      { status: 400 },
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;

  try {
    await stopSlackWorkspace(workspaceId).catch(() => undefined);
    return NextResponse.json({ workspaces: deleteSlackWorkspaceSettings(workspaceId) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete Slack workspace settings." },
      { status: 400 },
    );
  }
}
