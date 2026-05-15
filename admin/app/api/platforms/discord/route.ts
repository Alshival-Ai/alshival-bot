import { NextRequest, NextResponse } from "next/server";
import { getPlatformRuntime } from "@/lib/backend";
import { getDiscordSettings, saveDiscordSettings } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function withRuntimeStatus() {
  const settings = getDiscordSettings();

  try {
    return {
      ...settings,
      runtime: await getPlatformRuntime("discord"),
      backendReachable: true,
    };
  } catch (error) {
    return {
      ...settings,
      runtime: null,
      backendReachable: false,
      backendError: error instanceof Error ? error.message : "Backend is unavailable.",
    };
  }
}

export async function GET() {
  return NextResponse.json(await withRuntimeStatus());
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { token?: unknown; enabled?: unknown };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const enabled = Boolean(body.enabled);

  saveDiscordSettings({ token, enabled });

  return NextResponse.json(await withRuntimeStatus());
}
