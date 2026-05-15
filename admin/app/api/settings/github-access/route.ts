import { NextRequest, NextResponse } from "next/server";
import {
  deleteGithubAccessSettings,
  getGithubAccessSettings,
  saveGithubAccessSettings,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getGithubAccessSettings());
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    oauthClientId?: unknown;
    personalAccessToken?: unknown;
  };

  return NextResponse.json(
    saveGithubAccessSettings({
      oauthClientId: typeof body.oauthClientId === "string" ? body.oauthClientId : "",
      personalAccessToken:
        typeof body.personalAccessToken === "string" ? body.personalAccessToken : "",
    }),
  );
}

export function DELETE() {
  return NextResponse.json(deleteGithubAccessSettings());
}
