import { NextRequest, NextResponse } from "next/server";
import { getSlackWorkspaces, startPlatform } from "@/lib/backend";
import { saveSlackWorkspaceSettings } from "@/lib/db";

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

async function requestSlackJson<T>(url: string, token: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    cache: "no-store",
  });
  const data = (await response.json()) as T & { ok?: boolean; error?: string };

  if (!response.ok || data.ok === false) {
    throw new Error(data.error ?? "Slack API request failed.");
  }

  return data;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      botToken?: unknown;
      appToken?: unknown;
      enabled?: unknown;
      start?: unknown;
    };
    const botToken = typeof body.botToken === "string" ? body.botToken.trim() : "";
    const appToken = typeof body.appToken === "string" ? body.appToken.trim() : "";

    if (!botToken || !appToken) {
      return NextResponse.json({ error: "Bot token and app-level token are required." }, { status: 400 });
    }

    const auth = await requestSlackJson<{
      team_id?: string;
      team?: string;
      user_id?: string;
      user?: string;
    }>("https://slack.com/api/auth.test", botToken);

    if (!auth.team_id) {
      throw new Error("Slack auth.test did not return a workspace ID.");
    }

    const team = await requestSlackJson<{
      team?: {
        name?: string;
        domain?: string;
      };
    }>(`https://slack.com/api/team.info?team=${encodeURIComponent(auth.team_id)}`, botToken);

    const workspace = saveSlackWorkspaceSettings({
      workspaceId: auth.team_id,
      workspaceName: team.team?.name ?? auth.team ?? null,
      workspaceDomain: team.team?.domain ?? null,
      botToken,
      appToken,
      enabled: body.enabled !== false,
      desiredRunning: body.start !== false,
      botUserId: auth.user_id ?? null,
      botName: auth.user ?? null,
    });

    if (body.start !== false) {
      await startPlatform("slack");
    }

    const backendWorkspaces = await getSlackWorkspaces();
    return NextResponse.json({ workspace, workspaces: backendWorkspaces.workspaces });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save Slack workspace." },
      { status: 400 },
    );
  }
}
