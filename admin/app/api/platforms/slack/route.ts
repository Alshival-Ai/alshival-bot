import { NextRequest, NextResponse } from "next/server";
import { getPlatformRuntime } from "@/lib/backend";
import { getSlackSettings, saveSlackSettings } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function withRuntimeStatus() {
  const settings = getSlackSettings();

  try {
    return {
      ...settings,
      runtime: await getPlatformRuntime("slack"),
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
  const body = (await request.json()) as {
    botToken?: unknown;
    appToken?: unknown;
    enabled?: unknown;
  };

  saveSlackSettings({
    botToken: typeof body.botToken === "string" ? body.botToken.trim() : "",
    appToken: typeof body.appToken === "string" ? body.appToken.trim() : "",
    enabled: Boolean(body.enabled),
  });

  return NextResponse.json(await withRuntimeStatus());
}
