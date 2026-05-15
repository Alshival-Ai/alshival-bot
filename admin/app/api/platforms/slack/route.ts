import { getPlatformRuntime } from "@/lib/backend";
import { NextResponse } from "next/server";
import { getSlackWorkspaceSettings } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function withRuntimeStatus() {
  const workspaces = getSlackWorkspaceSettings();

  try {
    return {
      workspaceCount: workspaces.length,
      configuredWorkspaceCount: workspaces.filter((workspace) => workspace.hasBotToken && workspace.hasAppToken).length,
      enabledWorkspaceCount: workspaces.filter((workspace) => workspace.enabled).length,
      runtime: await getPlatformRuntime("slack"),
      backendReachable: true,
    };
  } catch (error) {
    return {
      workspaceCount: workspaces.length,
      configuredWorkspaceCount: workspaces.filter((workspace) => workspace.hasBotToken && workspace.hasAppToken).length,
      enabledWorkspaceCount: workspaces.filter((workspace) => workspace.enabled).length,
      runtime: null,
      backendReachable: false,
      backendError: error instanceof Error ? error.message : "Backend is unavailable.",
    };
  }
}

export async function GET() {
  return NextResponse.json(await withRuntimeStatus());
}
