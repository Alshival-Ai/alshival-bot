import { NextRequest, NextResponse } from "next/server";
import { deleteSlackWorkspaceChatHistory } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ workspaceId: string }>;
};

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  return NextResponse.json(deleteSlackWorkspaceChatHistory(workspaceId));
}
